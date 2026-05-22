import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import tailwindStyles from "./tailwind.css?url";

export function links() {
  return [
    { rel: "stylesheet", href: polarisStyles },
    { rel: "stylesheet", href: tailwindStyles }
  ];
}

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
        <style>{`
          :root {
            --bmo-primary: #1F2937;
            --bmo-secondary: #1F6FEB;
            --bmo-primary-light: #F1F5F9;
          }
          .Polaris-IndexTable__TableHeading {
            background: #F1F3F5 !important;
            color: #334155 !important;
          }
          .Polaris-IndexTable__TableRow:hover {
            background: #F8FAFC !important;
          }
          .Polaris-IndexTable__TableRow--selected {
            background: #E9F2FF !important;
          }
          .Polaris-Tabs__Tab--selected {
            border-bottom-color: #1F2937 !important;
          }
          .bmo-primary-btn {
            background: #1F2937 !important;
            color: white !important;
            border: none !important;
            border-radius: 7px !important;
            box-shadow: 0 1px 1px rgba(17, 24, 39, 0.18) !important;
            padding: 10px 20px !important;
            font-weight: 620;
            cursor: pointer;
          }
          .bmo-primary-btn:hover {
            background: #111827 !important;
          }
          .bmo-bulk-bar {
            background: #1F2937;
            color: white;
            padding: 12px 16px;
            border-radius: 7px;
            position: sticky;
            top: 0;
            z-index: 10;
            margin-bottom: 12px;
            display: flex;
            align-items: center;
            gap: 12px;
          }
          .bmo-kpi-card {
            border-top: 3px solid #1F2937;
            box-shadow: 0 1px 4px rgba(15, 23, 42, 0.08);
            border-radius: 8px;
          }
        `}</style>
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
