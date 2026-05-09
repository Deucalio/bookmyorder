export type CourierField = {
  key: string;
  label: string;
  type: "text" | "password";
  required?: boolean;
  placeholder?: string;
};

export type CourierConfig = {
  code: string;
  name: string;
  logoUrl?: string;
  isActive: boolean;
  sortOrder: number;
  credentialFields: CourierField[];
};

export const COURIERS: CourierConfig[] = [
  {
    code: "leopards",
    name: "Leopards Courier",
    sortOrder: 1,
    isActive: true,
    credentialFields: [
      { key: "apiKey", label: "API Key", type: "password", required: true },
      { key: "apiPassword", label: "API Password", type: "password", required: true },
    ],
  },
  {
    code: "tcs",
    name: "TCS",
    sortOrder: 2,
    isActive: true,
    credentialFields: [
      { key: "clientId", label: "Client ID", type: "text", required: true },
      { key: "username", label: "Username", type: "text", required: true },
      { key: "password", label: "Password", type: "password", required: true },
    ],
  },
  {
    code: "postex",
    name: "PostEx",
    sortOrder: 3,
    isActive: true,
    credentialFields: [
      { key: "token", label: "API Token", type: "password", required: true },
    ],
  },
  {
    code: "trax",
    name: "Trax",
    sortOrder: 4,
    isActive: true,
    credentialFields: [
      { key: "username", label: "Username", type: "text", required: true },
      { key: "password", label: "Password", type: "password", required: true },
    ],
  },
  {
    code: "rider",
    name: "Rider",
    sortOrder: 5,
    isActive: true,
    credentialFields: [
      { key: "apiKey", label: "API Key", type: "password", required: true },
    ],
  },
];

export const getCourierByCode = (code: string) =>
  COURIERS.find((c) => c.code === code);

export const getActiveCouriers = () =>
  COURIERS.filter((c) => c.isActive).sort((a, b) => a.sortOrder - b.sortOrder);
