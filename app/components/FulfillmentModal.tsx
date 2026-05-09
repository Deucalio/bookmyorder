import { useState, useEffect, useMemo } from "react";

const COURIERS = [
  { id: "tcs", name: "TCS", est: "Est. 24-48h", cost: 4.50 },
  { id: "leopards", name: "Leopards", est: "Est. 48-72h", cost: 3.80 },
  { id: "mp", name: "M&P", est: "Est. 24h", cost: 6.20 },
  { id: "trax", name: "Trax", est: "Est. Same Day", cost: 8.00 },
];

export function FulfillmentModal({
  open,
  onClose,
  initialSelectedIds,
  orders,
}: {
  open: boolean;
  onClose: () => void;
  initialSelectedIds: string[];
  orders: any[];
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedCourier, setSelectedCourier] = useState("tcs");
  const [expandedOrders, setExpandedOrders] = useState<Record<string, boolean>>({});

  const [instructions, setInstructions] = useState("");
  const [autoGenTracking, setAutoGenTracking] = useState(true);
  const [autoPrintManifests, setAutoPrintManifests] = useState(false);
  const [weights, setWeights] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      setSelectedIds(initialSelectedIds);
      const newWeights = { ...weights };
      initialSelectedIds.forEach((id) => {
        if (!newWeights[id]) newWeights[id] = "1.2";
      });
      setWeights(newWeights);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialSelectedIds]);

  const handleSelectOrder = (id: string, checked: boolean) => {
    if (checked) {
      setSelectedIds((prev) => [...prev, id]);
    } else {
      setSelectedIds((prev) => prev.filter((item) => item !== id));
    }
  };

  const toggleAccordion = (id: string, e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName.toLowerCase() === "input") {
      return;
    }
    setExpandedOrders((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const selectedCourierData = COURIERS.find((c) => c.id === selectedCourier);
  const totalCost = selectedIds.length * (selectedCourierData?.cost || 0);

  const aggregateWeight = useMemo(() => {
    return selectedIds.reduce((sum, id) => {
      const w = parseFloat(weights[id] || "0");
      return sum + (isNaN(w) ? 0 : w);
    }, 0);
  }, [selectedIds, weights]);

  const modalOrders = useMemo(() => {
    return orders.filter(
      (o) => selectedIds.includes(o.id) || o.status === "pending" || o.status === "assigned"
    );
  }, [orders, selectedIds]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 lg:p-8">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity" 
        onClick={onClose}
      ></div>

      {/* Modal Container */}
      <div className="relative w-full max-w-7xl max-h-full flex flex-col bg-slate-50 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Modal Header */}
        <div className="flex justify-between items-center px-6 py-4 bg-white border-b border-gray-200 shrink-0">
          <h2 className="text-2xl font-bold text-gray-800 tracking-tight">Launch Fulfillment</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-500 transition">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 min-h-0">
          {/* Courier Selection */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {COURIERS.map((courier) => {
              const isSelected = selectedCourier === courier.id;
              return (
                <div
                  key={courier.id}
                  onClick={() => setSelectedCourier(courier.id)}
                  className={`
                    relative flex flex-col justify-between p-5 rounded-xl cursor-pointer border-2 transition-all duration-200
                    ${isSelected 
                      ? "border-indigo-600 bg-indigo-50 shadow-md shadow-indigo-100" 
                      : "border-transparent bg-white shadow-sm hover:shadow-md hover:border-gray-300"
                    }
                  `}
                >
                  <div className="flex justify-between items-start mb-4">
                    <span className={`font-semibold text-xl ${isSelected ? "text-indigo-900" : "text-gray-800"}`}>
                      {courier.name}
                    </span>
                    {isSelected && (
                      <div className="text-white bg-indigo-600 rounded-full shadow-sm p-1">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      </div>
                    )}
                  </div>
                  <div className="flex justify-between items-end">
                    <span className="text-sm font-medium text-gray-500">{courier.est}</span>
                    <span className="font-bold text-gray-900 text-lg">${courier.cost.toFixed(2)}<span className="text-xs text-gray-500 font-normal">/ea</span></span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-col xl:flex-row gap-6 items-start">
            
            {/* Left: Orders List */}
            <div className="flex-[3] w-full bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="hidden lg:grid grid-cols-[50px_100px_1.5fr_1fr_100px_80px_120px] items-center px-4 py-3 bg-gray-50 border-b border-gray-200 text-xs font-bold text-gray-500 tracking-wider">
                <div></div>
                <div>ORDER #</div>
                <div>CUSTOMER</div>
                <div>ITEMS</div>
                <div>WEIGHT</div>
                <div>COD</div>
                <div>STATUS</div>
              </div>

              <div className="divide-y divide-gray-100">
                {modalOrders.map((order) => {
                  const isSelected = selectedIds.includes(order.id);
                  const isExpanded = expandedOrders[order.id];

                  // Determine badge color
                  let badgeClass = "bg-yellow-100 text-yellow-800";
                  if (order.status === "fulfilled") badgeClass = "bg-green-100 text-green-800";
                  else if (order.status === "assigned") badgeClass = "bg-blue-100 text-blue-800";

                  return (
                    <div
                      key={order.id}
                      className={`transition-colors ${isSelected ? "bg-indigo-50/30" : "bg-white hover:bg-gray-50"}`}
                    >
                      <div
                        className={`grid grid-cols-[40px_1fr] lg:grid-cols-[50px_100px_1.5fr_1fr_100px_80px_120px] items-center px-4 py-3 gap-y-3 gap-x-2 cursor-pointer border-l-4 transition-all ${
                          isSelected ? "border-l-indigo-600" : "border-l-transparent"
                        }`}
                        onClick={(e) => toggleAccordion(order.id, e)}
                      >
                        <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
                          <input 
                            type="checkbox"
                            className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 cursor-pointer"
                            checked={isSelected}
                            onChange={(e) => handleSelectOrder(order.id, e.target.checked)}
                          />
                        </div>
                        
                        <div className="font-semibold text-gray-800 lg:text-sm">{order.orderName}</div>
                        
                        <div className="text-gray-600 font-medium text-sm lg:col-auto col-span-2 ml-10 lg:ml-0">
                          {order.customerName}
                        </div>
                        
                        <div className="text-gray-500 text-sm truncate lg:col-auto col-span-2 ml-10 lg:ml-0">
                          1x Item, Standard
                        </div>
                        
                        <div className="w-20 lg:col-auto col-span-2 ml-10 lg:ml-0 relative" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="text"
                            className="w-full pl-2 pr-6 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                            value={weights[order.id] || ""}
                            onChange={(e) => setWeights((prev) => ({ ...prev, [order.id]: e.target.value }))}
                          />
                          <span className="absolute right-2 top-1.5 text-xs text-gray-400 pointer-events-none">kg</span>
                        </div>
                        
                        <div className="font-bold text-gray-800 text-sm lg:col-auto col-span-2 ml-10 lg:ml-0">
                          Rs. {order.codAmount}
                        </div>
                        
                        <div className="lg:col-auto col-span-2 ml-10 lg:ml-0">
                          <span className={`px-2.5 py-1 text-xs font-semibold rounded-md ${badgeClass}`}>
                            {order.status.toUpperCase()}
                          </span>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="p-5 bg-slate-50 border-t border-gray-100 lg:ml-0 rounded-b-lg animate-in slide-in-from-top-2 duration-200">
                          <h4 className="text-sm font-semibold text-gray-800 mb-3">Delivery Details</h4>
                          <div className="flex flex-wrap gap-8">
                            <div>
                              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">City</p>
                              <p className="text-sm font-medium text-gray-900">{order.city || "Not Provided"}</p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Phone</p>
                              <p className="text-sm font-medium text-gray-900">{order.phone || "Not Provided"}</p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Area</p>
                              <p className="text-sm font-medium text-gray-900">{order.area || "Not Provided"}</p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right: Mission Parameters */}
            <div className="flex-[1] w-full min-w-[300px] flex flex-col gap-6 sticky top-0">
              
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                  <h3 className="font-bold text-gray-800 text-base">Mission Parameters</h3>
                  <div className="text-gray-400">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                </div>
                <div className="p-5 space-y-6">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 tracking-wider mb-2">
                      GLOBAL DELIVERY INSTRUCTIONS
                    </label>
                    <textarea
                      className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition outline-none resize-none"
                      rows={3}
                      value={instructions}
                      onChange={(e) => setInstructions(e.target.value)}
                      placeholder="e.g., Handle with care, deliver during business hours..."
                    />
                  </div>

                  <div className="space-y-4">
                    <label className="flex items-center justify-between cursor-pointer group">
                      <span className="text-sm font-medium text-gray-700 group-hover:text-gray-900">Auto-Generate Tracking</span>
                      <input 
                        type="checkbox" 
                        className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 cursor-pointer"
                        checked={autoGenTracking} 
                        onChange={(e) => setAutoGenTracking(e.target.checked)} 
                      />
                    </label>
                    <label className="flex items-center justify-between cursor-pointer group">
                      <span className="text-sm font-medium text-gray-700 group-hover:text-gray-900">Auto-Print Manifests</span>
                      <input 
                        type="checkbox" 
                        className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 cursor-pointer"
                        checked={autoPrintManifests} 
                        onChange={(e) => setAutoPrintManifests(e.target.checked)} 
                      />
                    </label>
                  </div>
                </div>
              </div>

              <div className="bg-slate-100 rounded-xl border border-slate-200 overflow-hidden">
                <div className="p-5 space-y-4">
                  <h4 className="text-xs font-bold text-slate-500 tracking-wider uppercase">Summary</h4>
                  
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-700">Total Selections</span>
                    <span className="text-base font-bold text-slate-900">{selectedIds.length}</span>
                  </div>
                  
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-700">Aggregate Weight</span>
                    <span className="text-base font-bold text-slate-900">{aggregateWeight.toFixed(1)} kg</span>
                  </div>

                  <div className="border-t border-slate-200 pt-4 mt-2 flex justify-between items-center">
                    <span className="font-bold text-slate-800">Est. Cost</span>
                    <span className="text-2xl font-black text-indigo-700">${totalCost.toFixed(2)}</span>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>

        {/* Custom Footer */}
        <div className="shrink-0 bg-indigo-900 px-6 py-4 flex flex-col sm:flex-row justify-between items-center gap-4 border-t border-indigo-800">
          <div className="flex gap-3 w-full sm:w-auto">
            <button 
              className="flex-1 sm:flex-none px-4 py-2 bg-transparent border border-indigo-400/50 text-indigo-200 rounded-lg hover:bg-white/5 hover:text-white transition font-medium text-sm"
              onClick={onClose}
            >
              Abort Mission
            </button>
            <button 
              className="flex-1 sm:flex-none px-4 py-2 bg-transparent border border-indigo-400/50 text-indigo-200 rounded-lg hover:bg-yellow-500/10 hover:border-yellow-500/50 hover:text-yellow-400 transition font-medium text-sm"
              onClick={() => setSelectedIds([])}
            >
              Purge Unready
            </button>
          </div>
          
          <div className="flex gap-3 w-full sm:w-auto">
            <button 
              className="flex-1 sm:flex-none px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg shadow-lg shadow-indigo-900/20 transition font-semibold"
              onClick={() => { console.log("Launch", selectedIds); onClose(); }}
            >
              Launch Fulfillment ({selectedIds.length})
            </button>
            <button 
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-2.5 bg-white text-indigo-900 hover:bg-indigo-50 rounded-lg shadow-lg transition font-bold"
              onClick={() => { console.log("Launch and Print", selectedIds); onClose(); }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-indigo-600" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5 4v3H4a2 2 0 00-2 2v3a2 2 0 002 2h1v2a2 2 0 002 2h6a2 2 0 002-2v-2h1a2 2 0 002-2V9a2 2 0 00-2-2h-1V4a2 2 0 00-2-2H7a2 2 0 00-2 2zm8 0H7v3h6V4zm0 8H7v4h6v-4z" clipRule="evenodd" />
              </svg>
              Launch & Print All
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
