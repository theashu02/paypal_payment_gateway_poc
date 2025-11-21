import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const PAYPAL_ENVIRONMENT = (process.env.PAYPAL_ENVIRONMENT || "sandbox").toLowerCase();
const PAYPAL_BASE_URL = PAYPAL_ENVIRONMENT === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
const PAYPAL_CURRENCY = (process.env.PAYPAL_CURRENCY || "USD").toUpperCase();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "data");
const TRANSACTIONS_LOG = path.join(DATA_DIR, "transactions.jsonl");

if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
  console.warn("⚠️  PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET is missing. Create a .env file before trying to accept payments.");
}

app.use(
  cors({
    origin: "http://localhost:3000",
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  })
);

app.use(express.json());

const amountToString = (value) => (Math.round(Number(value || 0) * 100) / 100).toFixed(2);

const normalizeItems = (items = []) => {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Missing cart items.");
  }

  return items.map((item, index) => {
    const name = item?.name?.trim();
    const quantity = Number(item?.quantity ?? 1);
    const price = Number(item?.price ?? 0);

    if (!name) {
      throw new Error(`Item #${index + 1} is missing a name.`);
    }
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error(`Item "${name}" has an invalid price.`);
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error(`Item "${name}" has an invalid quantity.`);
    }

    return {
      reference_id: item?.id ?? `ITEM-${index + 1}`,
      name,
      quantity: String(quantity),
      category: item?.category ?? "DIGITAL_GOODS",
      unit_amount: {
        currency_code: PAYPAL_CURRENCY,
        value: amountToString(price),
      },
    };
  });
};

const calculateOrderTotal = (items) => amountToString(items.reduce((sum, item) => sum + Number(item.unit_amount.value) * Number(item.quantity), 0));

const generateAccessToken = async () => {
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    throw new Error("Missing PayPal credentials.");
  }

  const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString("base64");

  const response = await fetch(`${PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to authenticate with PayPal: ${response.status} ${errorBody}`);
  }

  const data = await response.json();
  return data.access_token;
};

const paypalRequest = async (endpoint, { method = "POST", body } = {}) => {
  const accessToken = await generateAccessToken();
  const response = await fetch(`${PAYPAL_BASE_URL}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const responseBody = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(responseBody?.message || "PayPal API error.");
    error.paypal = responseBody;
    throw error;
  }

  return responseBody;
};

const extractCaptureSummary = (capturePayload = {}) => {
  const purchaseUnit = capturePayload.purchase_units?.[0];
  const capture = purchaseUnit?.payments?.captures?.[0];
  return {
    orderId: capturePayload.id,
    captureId: capture?.id,
    status: capture?.status,
    payerEmail: capturePayload?.payer?.email_address,
    payerGivenName: capturePayload?.payer?.name?.given_name,
    payerSurname: capturePayload?.payer?.name?.surname,
    amount: capture?.amount?.value,
    currency: capture?.amount?.currency_code,
    items: purchaseUnit?.items ?? [],
    createTime: capture?.create_time,
    updateTime: capture?.update_time,
  };
};

const persistCapture = async (capturePayload) => {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const summary = extractCaptureSummary(capturePayload);
    const record = {
      ...summary,
      loggedAt: new Date().toISOString(),
      raw: capturePayload,
    };
    await fs.appendFile(TRANSACTIONS_LOG, `${JSON.stringify(record)}\n`, "utf8");
  } catch (error) {
    console.error("Failed to persist capture record", error);
  }
};

app.get("/api/config", (req, res) => {
  res.json({
    clientId: PAYPAL_CLIENT_ID || "",
    currency: PAYPAL_CURRENCY,
    environment: PAYPAL_ENVIRONMENT,
  });
});

app.post("/api/orders", async (req, res, next) => {
  try {
    const items = normalizeItems(req.body?.items);
    const total = calculateOrderTotal(items);

    const orderPayload = {
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: {
            currency_code: PAYPAL_CURRENCY,
            value: total,
            breakdown: {
              item_total: {
                currency_code: PAYPAL_CURRENCY,
                value: total,
              },
            },
          },
          items,
        },
      ],
      application_context: {
        shipping_preference: "NO_SHIPPING",
        user_action: "PAY_NOW",
        brand_name: process.env.BRAND_NAME || "Payment Sample Store",
      },
    };

    const order = await paypalRequest("/v2/checkout/orders", {
      body: orderPayload,
    });

    res.status(201).json({ id: order.id });
  } catch (error) {
    next(error);
  }
});

app.post("/api/orders/:orderId/capture", async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const capture = await paypalRequest(`/v2/checkout/orders/${orderId}/capture`, {
      method: "POST",
    });
    await persistCapture(capture);
    res.json(capture);
  } catch (error) {
    next(error);
  }
});

app.use((err, req, res, _next) => {
  console.error("PayPal integration error:", err);
  const status = err.status || 500;
  res.status(status).json({
    message: err.message || "Unexpected server error.",
    ...(err.paypal ? { paypal: err.paypal } : {}),
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
