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
            --bmo-primary: #4F46E5;
            --bmo-secondary: #7C3AED;
            --bmo-primary-light: #EEF2FF;
          }
          .Polaris-IndexTable__TableHeading {
            background: #F5F3FF !important;
            color: #4F46E5 !important;
          }
          .Polaris-IndexTable__TableRow:hover {
            background: #F9F8FF !important;
          }
          .Polaris-IndexTable__TableRow--selected {
            background: #EEF2FF !important;
          }
          .Polaris-Tabs__Tab--selected {
            border-bottom-color: #4F46E5 !important;
          }
          .bmo-primary-btn {
            background: linear-gradient(135deg, #4F46E5, #7C3AED) !important;
            color: white !important;
            border: none !important;
            border-radius: 8px !important;
            box-shadow: 0 4px 14px rgba(79, 70, 229, 0.4) !important;
            padding: 10px 20px !important;
            font-weight: 500;
            cursor: pointer;
          }
          .bmo-primary-btn:hover {
            box-shadow: 0 6px 20px rgba(79, 70, 229, 0.5) !important;
          }
          .bmo-bulk-bar {
            background: #3730A3;
            color: white;
            padding: 12px 16px;
            border-radius: 8px;
            position: sticky;
            top: 0;
            z-index: 10;
            margin-bottom: 12px;
            display: flex;
            align-items: center;
            gap: 12px;
          }
          .bmo-kpi-card {
            border-top: 3px solid #4F46E5;
            box-shadow: 0 1px 4px rgba(79, 70, 229, 0.1);
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
