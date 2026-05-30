declare module "*.css";

import type {
  AnchorHTMLAttributes,
  DetailedHTMLProps,
  HTMLAttributes,
} from "react";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "s-app-nav": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;
      "s-link": DetailedHTMLProps<AnchorHTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}

export {};
