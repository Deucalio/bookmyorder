const prisma = require('../utils/prisma')
const { getCourierCode, getCourierName } = require('../utils/courierCompanies');
const RedisLock = require('../utils/redisLock');


// Follow code is from another project - not fully adapted yet, but will be soon. Ignore any references to "tracking cycle" or similar - that is just the internal name for our background job that fetches tracking data for fulfillments after they are created by this sync process.


/**
 * Main function called by the route - fetches shop data and syncs fulfillments
 */
async function appendShopifyFulfillments(shopId, daysBack = 45, startDate=null) {
  try {
    // First, get the shop data from the database
    const shop = await prisma.stores.findUnique({
      where: { id: Number.parseInt(shopId) },
      select: {
        id: true,
        shopify_domain: true,
        store_name: true,
        meta_data: true,
      },
    })

    if (!shop) {
      throw new Error(`Shop with ID ${shopId} not found`)
    }

    // Extract access token from meta_data or session
    let accessToken = null
    if (shop.meta_data && shop.meta_data.access_token) {
      accessToken = shop.meta_data.access_token
    } else {
      // Try to get from session table
      const session = await prisma.session.findFirst({
        where: { shop: shop.shopify_domain },
        select: { accessToken: true },
        orderBy: { expires: "desc" },
      })

      if (session) {
        accessToken = session.accessToken
      }
    }

    if (!accessToken) {
      throw new Error(`No access token found for shop ${shop.shopify_domain}`)
    }

    const shopData = {
      shop: shop.shopify_domain,
      shop_id: shop.id,
      access_token: accessToken,
      store_name: shop.store_name,
    }


    // Now run the actual sync
    const result = await syncShopifyFulfillments(shopData, daysBack, startDate)

    return {
      success: true,
      shop_id: shopId,
      shop_domain: shop.shopify_domain,
      ...result,
    }
  } catch (error) {
    console.error(`Error in appendShopifyFulfillments for shop ${shopId}:`, error)
    throw error
  }
}

/**
 * Internal sync function - processes the actual Shopify API calls and database operations
 */
async function syncShopifyFulfillments(shopData, daysBack = 45, startDate = null) {
  const { shop, shop_id: shopId, access_token: accessToken } = shopData

  // Acquire distributed lock to prevent concurrent sync for same shop
  const lockKey = `shopify-sync:shop:${shopId}`
  const lockTTL = 600; // 10 minutes - sync should complete in this time

  console.log(`🔒 Attempting to acquire sync lock for ${lockKey}...`)

  try {
    return await RedisLock.withLock(
      lockKey,
      async () => {
        let fromDate;

        console.log(`Starting fulfillment sync for shop ${shop} (ID: ${shopId}) with daysBack=${daysBack} and startDate=${startDate})`)

        if (startDate) {
          fromDate = new Date(startDate);
        } else {
          fromDate = new Date();
          fromDate.setDate(fromDate.getDate() - daysBack);
        }

        const fromDateStr = fromDate.toISOString().split("T")[0];

        console.log(`🔄 Syncing ${shop} from ${fromDateStr}`)

        const endpoint = `https://${shop}/admin/api/2024-01/graphql.json`
        const headers = {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        }

        // GraphQL query to get orders updated after the from_date
        const query = `
          query($cursor: String, $query: String) {
            orders(first: 50, after: $cursor, query: $query, sortKey: UPDATED_AT, reverse: true) {
              edges {
                cursor
                node {
                  id name createdAt displayFulfillmentStatus
                  fulfillments {
                    id
                    trackingInfo { number company }
                    createdAt status deliveredAt estimatedDeliveryAt
                  }
                  shippingAddress { name phone }
                }
              }
              pageInfo { hasNextPage endCursor }
            }
          }`

        let cursor = null
        let totalOrders = 0
        let totalFulfillments = 0
        let totalNewFulfillments = 0
        let batchNumber = 1
        let ordersSkippedNoFulfillments = 0
        let fulfillmentsSkippedByDate = 0
        let fulfillmentsSkippedCancelled = 0

        try {
          while (true) {
            console.log(`🔄 Processing batch ${batchNumber}`)

            // Step 1: Fetch one batch of orders (50 orders)
            const ordersBatch = await fetchOrdersBatch(endpoint, headers, query, cursor, fromDateStr)

            if (!ordersBatch.orders || ordersBatch.orders.length === 0) {
              console.log("✅ No more orders to process")
              break
            }

            console.log(`📥 Fetched ${ordersBatch.orders.length} orders`)

            // Step 2: Filter orders that have valid (non-cancelled) fulfillments in our date range
            const { filteredOrders, skippedOrders, validFulfillmentsCount, cancelledCount } =
              filterOrdersWithValidFulfillments(ordersBatch.orders, fromDate)

            ordersSkippedNoFulfillments += skippedOrders
            fulfillmentsSkippedCancelled += cancelledCount

            if (filteredOrders.length === 0) {
              console.log("  ⏭️  No orders with valid fulfillments in this batch")
              // Check for next page
              if (!ordersBatch.hasNextPage) {
                break
              }
              cursor = ordersBatch.endCursor
              batchNumber++
              continue
            }

            console.log(
              `  📋 ${filteredOrders.length} orders have valid fulfillments in date range (${validFulfillmentsCount} fulfillments)`,
            )
            if (cancelledCount > 0) {
              console.log(`  ❌ Skipped ${cancelledCount} cancelled fulfillments`)
            }

            // Step 3: Process and insert/update ONLY filtered orders
            console.log("  📦 Processing filtered orders...")
            const orderMapping = await processOrdersBatch(filteredOrders, shopId)

            console.log("  ✅ Orders committed to database")
            totalOrders += filteredOrders.length

            // Step 4: Now process fulfillments (after orders are committed)
            console.log("  📋 Processing fulfillments...")
            const { fulfillmentsData, skippedCount } = prepareFulfillmentsBatch(filteredOrders, orderMapping, fromDate)

            if (fulfillmentsData.length > 0) {
              const newFulfillmentsCount = await processFulfillmentsBatch(fulfillmentsData)
              totalFulfillments += fulfillmentsData.length
              totalNewFulfillments += newFulfillmentsCount
              fulfillmentsSkippedByDate += skippedCount

              console.log(`  ✅ Processed ${fulfillmentsData.length} fulfillments (${newFulfillmentsCount} new)`)
            }

            if (skippedCount > 0) {
              console.log(`  ⏭️  Skipped ${skippedCount} fulfillments (before ${fromDateStr})`)
            }

            // Check for next page
            if (!ordersBatch.hasNextPage) {
              break
            }

            cursor = ordersBatch.endCursor
            batchNumber++

            // Rate limiting between batches
            await sleep(500)
            console.log("  " + "=".repeat(50))
          }

          const result = {
            totalOrders,
            totalFulfillments,
            totalNewFulfillments,
            ordersSkippedNoFulfillments,
            fulfillmentsSkippedByDate,
            fulfillmentsSkippedCancelled,
          }

          console.log(
            `✅ Sync complete: ${totalOrders} orders, ${totalFulfillments} fulfillments (${totalNewFulfillments} new)`,
          )
          if (ordersSkippedNoFulfillments > 0) {
            console.log(`⚠️  Skipped ${ordersSkippedNoFulfillments} orders (no valid fulfillments in date range)`)
          }
          if (fulfillmentsSkippedByDate > 0) {
            console.log(`⚠️  Skipped ${fulfillmentsSkippedByDate} fulfillments due to date filter`)
          }
          if (fulfillmentsSkippedCancelled > 0) {
            console.log(`❌ Skipped ${fulfillmentsSkippedCancelled} cancelled fulfillments`)
          }

          return result
        } catch (error) {
          console.error(`❌ Error: ${error.message}`)
          throw error
        }
      },
      lockTTL
    )
  } catch (error) {
    if (error.message.includes('Failed to acquire lock')) {
      console.warn(`⏳ Shopify sync already in progress for shop ${shopId}. Skipping to prevent duplicates.`)
      return {
        totalOrders: 0,
        totalFulfillments: 0,
        totalNewFulfillments: 0,
        ordersSkippedNoFulfillments: 0,
        fulfillmentsSkippedByDate: 0,
        fulfillmentsSkippedCancelled: 0,
        message: 'Sync already in progress'
      }
    }
    console.error(`❌ Error acquiring sync lock: ${error.message}`)
    throw error
  } finally {
    // Do not disconnect here — the shared prisma client is used by the tracking cycle after this
  }
}

/**
 * Fetch one batch of orders from Shopify API
 */
async function fetchOrdersBatch(endpoint, headers, query, cursor, fromDateStr) {
  // API Request with retry
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          query,
          variables: {
            cursor,
            query: `updated_at:>=${fromDateStr}`,
          },
        }),
        timeout: 30000,
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()

      if (data.errors) {
        throw new Error(`GraphQL error: ${JSON.stringify(data.errors)}`)
      }

      // Rate limiting check
      const throttle = data.extensions?.cost?.throttleStatus
      if (throttle && throttle.currentlyAvailable < 100) {
        const sleepTime = Math.max(1000, (60 / (throttle.restoreRate || 50)) * 1000)
        console.log(`  ⏸️  Rate limiting: sleeping for ${(sleepTime / 1000).toFixed(1)}s`)
        await sleep(sleepTime)
      }

      const ordersData = data.data?.orders || {}
      const edges = ordersData.edges || []
      const pageInfo = ordersData.pageInfo || {}

      return {
        orders: edges.map((edge) => edge.node),
        hasNextPage: pageInfo.hasNextPage || false,
        endCursor: pageInfo.endCursor,
      }
    } catch (error) {
      if (attempt === 2) {
        throw new Error(`API failed: ${error.message}`)
      }
      console.log(`  ⚠️  API attempt ${attempt + 1} failed: ${error.message}`)
      await sleep(Math.pow(2, attempt) * 1000)
    }
  }
}

/**
 * Filter orders to only include those with valid (non-cancelled) fulfillments in the date range
 */
function filterOrdersWithValidFulfillments(orders, fromDate) {
  const filteredOrders = []
  let skippedOrders = 0
  let totalValidFulfillments = 0
  let totalCancelledFulfillments = 0

  for (const order of orders) {
    let hasValidFulfillments = false
    let validFulfillmentsInOrder = 0
    let cancelledFulfillmentsInOrder = 0

    // Check if this order has any valid fulfillments in our date range
    for (const fulfillment of order.fulfillments || []) {
      const fulfillmentStatus = (fulfillment.status || "").toUpperCase()

      // Skip cancelled fulfillments
      if (fulfillmentStatus === "CANCELLED") {
        cancelledFulfillmentsInOrder++
        continue
      }

      let fulfillmentCreated = fulfillment.createdAt

      // Handle missing created date
      if (!fulfillmentCreated) {
        fulfillmentCreated = order.createdAt // Fallback to order date
      }

      try {
        const createdDateTime = new Date(fulfillmentCreated)
        if (createdDateTime >= fromDate) {
          hasValidFulfillments = true
          validFulfillmentsInOrder++
        }
      } catch (error) {
        // If date parsing fails, include the fulfillment (unless it's cancelled)
        hasValidFulfillments = true
        validFulfillmentsInOrder++
      }
    }

    totalCancelledFulfillments += cancelledFulfillmentsInOrder

    if (hasValidFulfillments) {
      // Filter out cancelled fulfillments from the order before adding it
      const filteredOrder = {
        ...order,
        fulfillments: (order.fulfillments || []).filter((f) => (f.status || "").toUpperCase() !== "CANCELLED"),
      }
      filteredOrders.push(filteredOrder)
      totalValidFulfillments += validFulfillmentsInOrder
    } else {
      skippedOrders++
    }
  }

  return {
    filteredOrders,
    skippedOrders,
    validFulfillmentsCount: totalValidFulfillments,
    cancelledCount: totalCancelledFulfillments,
  }
}

/**
 * Process a batch of orders and return mapping of shopify_order_id to internal order_id
 */
async function processOrdersBatch(orders, shopId) {
  const ordersData = []
  const shopifyOrderIds = []

  for (const order of orders) {
    const orderId = BigInt(order.id.split("/").pop())
    shopifyOrderIds.push(orderId)
    const shipping = order.shippingAddress || {}

    ordersData.push({
      shop_id: shopId,
      shopify_order_id: orderId,
      order_number: order.name,
      customer_name: shipping.name || null,
      customer_phone: shipping.phone ? shipping.phone.substring(0, 20) : null,
      status: order.displayFulfillmentStatus,
      placed_at: new Date(order.createdAt),
      meta_data: order,
    })
  }

  // Get existing orders using Prisma
  const existingOrders = await prisma.orders.findMany({
    where: {
      shop_id: shopId,
      shopify_order_id: {
        in: shopifyOrderIds,
      },
    },
    select: {
      id: true,
      shopify_order_id: true,
    },
  })

  const existingOrdersMap = {}
  existingOrders.forEach((order) => {
    existingOrdersMap[order.shopify_order_id.toString()] = order.id
  })

  // Separate new and existing orders
  const newOrders = ordersData.filter((o) => !existingOrdersMap[o.shopify_order_id.toString()])
  const updateOrders = ordersData.filter((o) => existingOrdersMap[o.shopify_order_id.toString()])

  // Bulk insert new orders using Prisma
  if (newOrders.length > 0) {
    await prisma.orders.createMany({
      data: newOrders,
      skipDuplicates: true,
    })

    // Get the newly inserted order IDs
    const newlyInsertedOrders = await prisma.orders.findMany({
      where: {
        shop_id: shopId,
        shopify_order_id: {
          in: newOrders.map((o) => o.shopify_order_id),
        },
      },
      select: {
        id: true,
        shopify_order_id: true,
      },
    })

    newlyInsertedOrders.forEach((order) => {
      existingOrdersMap[order.shopify_order_id.toString()] = order.id
    })
  }

  // Bulk update existing orders using Prisma transactions
  if (updateOrders.length > 0) {
    const updatePromises = updateOrders.map((order) =>
      prisma.orders.update({
        where: {
          id: existingOrdersMap[order.shopify_order_id.toString()],
        },
        data: {
          order_number: order.order_number,
          customer_name: order.customer_name,
          customer_phone: order.customer_phone,
          status: order.status,
          placed_at: order.placed_at,
          meta_data: order.meta_data,
        },
      }),
    )

    await prisma.$transaction(updatePromises)
  }

  console.log(`    📊 Orders: ${newOrders.length} new, ${updateOrders.length} updated`)
  return existingOrdersMap
}

/**
 * Prepare fulfillments data for database insertion, filtering by date and status
 */
function prepareFulfillmentsBatch(orders, orderMapping, fromDate) {
  const fulfillmentsData = []
  let fulfillmentsSkipped = 0

  for (const order of orders) {
    const shopifyOrderId = BigInt(order.id.split("/").pop())
    const internalOrderId = orderMapping[shopifyOrderId.toString()]

    if (!internalOrderId) {
      console.log(`    ⚠️  Warning: Could not find internal order ID for Shopify order ${shopifyOrderId}`)
      continue
    }

    for (const fulfillment of order.fulfillments || []) {
      const fulfillmentStatus = (fulfillment.status || "").toUpperCase()

      // Skip cancelled fulfillments (double-check, should already be filtered)
      if (fulfillmentStatus === "CANCELLED") {
        continue
      }

      let fulfillmentCreated = fulfillment.createdAt

      // Handle missing created date
      if (!fulfillmentCreated) {
        fulfillmentCreated = order.createdAt // Fallback to order date
      }

      // Filter by fulfillment created date
      try {
        const createdDateTime = new Date(fulfillmentCreated)
        if (createdDateTime < fromDate) {
          fulfillmentsSkipped++
          continue
        }
      } catch (error) {
        // If date parsing fails, include the fulfillment
      }

      const tracking = (fulfillment.trackingInfo && fulfillment.trackingInfo[0]) || {}
      let estDelivery = null
      if (fulfillment.estimatedDeliveryAt) {
        try {
          estDelivery = new Date(fulfillment.estimatedDeliveryAt)
        } catch (error) {
          // Ignore parsing errors
        }
      }

      fulfillmentsData.push({
        order_id: internalOrderId,
        tracking_number: tracking.number || null,
        courier_name: getCourierName(tracking.company),
        courier_code: getCourierCode(tracking.company),
        status: "NOT_TRACKED",
        completed_at: null, // only set by tracking cycle after actual tracking data is retrieved
        estimated_delivery: estDelivery,
        last_checked_at: null, // null so tracking cycle picks it up immediately
        created_at: new Date(fulfillmentCreated),
    meta_data: {
        ...fulfillment,
        admin_graphql_api_id: fulfillment.id?.startsWith('gid://')
          ? fulfillment.id
          : `gid://shopify/Fulfillment/${fulfillment.id}`,
      },
      })
    }
  }

  return { fulfillmentsData, skippedCount: fulfillmentsSkipped }
}

/**
 * Process a batch of fulfillments and return count of new fulfillments
 * Uses atomic transaction to prevent duplicate fulfillments
 */
async function processFulfillmentsBatch(fulfillmentsData) {
  if (fulfillmentsData.length === 0) {
    return 0
  }

  // Get existing fulfillments for duplicate detection using Prisma
  const orderIds = [...new Set(fulfillmentsData.map((f) => f.order_id))]
  const existingFulfillments = await prisma.fulfillments.findMany({
    where: {
      order_id: {
        in: orderIds,
      },
    },
    select: {
      id: true,
      order_id: true,
      tracking_number: true,
    },
  })

  const existingFulfillmentsMap = {}
  existingFulfillments.forEach((fulfillment) => {
    const key = `${fulfillment.order_id}_${fulfillment.tracking_number || "NO_TRACKING"}`
    existingFulfillmentsMap[key] = fulfillment.id
  })

  const newFulfillments = []
  const updateFulfillments = []

  for (const f of fulfillmentsData) {
    // Create key for matching (order_id + tracking_number)
    const trackingKey = f.tracking_number || "NO_TRACKING"
    const key = `${f.order_id}_${trackingKey}`

    const existingId = existingFulfillmentsMap[key]

    if (existingId) {
      updateFulfillments.push({
        id: existingId,
        data: f,
      })
    } else {
      newFulfillments.push(f)
    }
  }

  // Insert new fulfillments using atomic transaction
  // This prevents race conditions where two concurrent requests create the same fulfillment
  let successfulInserts = 0

  if (newFulfillments.length > 0) {
    for (const newFulfillment of newFulfillments) {
      try {
        // Use transaction for each insert to ensure atomicity
        const result = await prisma.$transaction(async (tx) => {
          // 1. ATOMIC READ: Check if this exact fulfillment exists
          const existingRecord = await tx.fulfillments.findFirst({
            where: {
              order_id: newFulfillment.order_id,
              tracking_number: newFulfillment.tracking_number,
            },
            select: { id: true },
          })

          // If already exists, skip
          if (existingRecord) {
            return { inserted: false, reason: 'Already exists' }
          }

          // 2. ATOMIC WRITE: Create the fulfillment
          await tx.fulfillments.create({
            data: newFulfillment,
          })

          return { inserted: true }
        }, {
          isolationLevel: 'Serializable', // Strongest isolation level
          timeout: 10000 // 10 second timeout
        })

        if (result.inserted) {
          successfulInserts++
        }
      } catch (error) {
        // Log error but continue with next fulfillment
        // This prevents one error from blocking all inserts
        console.warn(`  ⚠️  Could not insert fulfillment for order ${newFulfillment.order_id}:`, error.message)
      }
    }
  }

  // Update existing fulfillments using Prisma transactions
  if (updateFulfillments.length > 0) {
    const updatePromises = updateFulfillments.map((item) =>
      prisma.fulfillments.update({
        where: { id: item.id },
        data: {
          courier_name: getCourierName(item.data.courier_name),
          courier_code: item.data.courier_code,
          // do not overwrite status or completed_at — those are owned by the tracking cycle
          estimated_delivery: item.data.estimated_delivery,
          meta_data: item.data.meta_data,
        },
      }),
    )

    await prisma.$transaction(updatePromises)
  }

  console.log(`    📊 Fulfillments: ${successfulInserts} new, ${updateFulfillments.length} updated`)
  return successfulInserts
}

/**
 * Map courier company name to standardized code
 */


/**
 * Sleep utility function
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

module.exports = appendShopifyFulfillments
