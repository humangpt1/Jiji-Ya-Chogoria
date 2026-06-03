const axios = require("axios");

const MEGAPAY_BASE = "https://megapay.co.ke/backend/v1";
const MEGAPAY_API_KEY = process.env.MEGAPAY_API_KEY;
const MEGAPAY_EMAIL = process.env.MEGAPAY_EMAIL;

/**
 * Normalize Kenyan phone numbers to 2547XXXXXXXX
 */
const normalizePhone = (phone) => {
  const cleaned = String(phone || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/^\+/, "");

  if (cleaned.startsWith("254")) {
    return cleaned;
  }

  if (cleaned.startsWith("0")) {
    return `254${cleaned.slice(1)}`;
  }

  return cleaned;
};

/**
 * Initiate MegaPay STK Push
 */
const initiateSTKPush = async ({ phone, amount, reference }) => {
  if (!MEGAPAY_API_KEY) {
    throw new Error("MEGAPAY_API_KEY is missing from environment variables.");
  }

  if (!MEGAPAY_EMAIL) {
    throw new Error("MEGAPAY_EMAIL is missing from environment variables.");
  }

  if (!phone) {
    throw new Error("Phone number is required.");
  }

  if (!amount || Number(amount) < 1) {
    throw new Error("Amount must be greater than 0.");
  }

  if (!reference) {
    throw new Error("Payment reference is required.");
  }

  const msisdn = normalizePhone(phone);

  const payload = {
    api_key: MEGAPAY_API_KEY,
    email: MEGAPAY_EMAIL,
    amount: String(Math.ceil(Number(amount))),
    msisdn,
    reference: String(reference),
  };

  const url = `${MEGAPAY_BASE}/initiatestk`;

  try {
    console.log("========================================");
    console.log("MEGAPAY STK REQUEST");
    console.log("URL:", url);
    console.log("Reference:", reference);
    console.log("Phone:", msisdn);
    console.log("Amount:", payload.amount);
    console.log("========================================");

    const response = await axios.post(url, payload, {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      timeout: 30000,
    });

    const data = response.data;

    console.log("========================================");
    console.log("MEGAPAY RESPONSE");
    console.log(JSON.stringify(data, null, 2));
    console.log("========================================");

    const message = data.massage || data.message || data.msg || "";

    const successCode = String(data.success);

    if (successCode !== "200") {
      throw new Error(
        message || `MegaPay rejected request. Response code: ${successCode}`,
      );
    }

    if (!data.transaction_request_id) {
      throw new Error("MegaPay did not return transaction_request_id.");
    }

    return {
      transaction_request_id: data.transaction_request_id,
      message,
    };
  } catch (error) {
    console.error("========================================");
    console.error("MEGAPAY ERROR");
    console.error("URL:", url);

    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Status Text:", error.response.statusText);
      console.error("Response Data:", error.response.data);
    } else if (error.request) {
      console.error(
        "No response received from MegaPay. Request may have timed out.",
      );
    } else {
      console.error("Error:", error.message);
    }

    console.error("========================================");

    throw new Error(
      error.response?.data?.massage ||
        error.response?.data?.message ||
        error.message ||
        "Failed to initiate MegaPay STK Push.",
    );
  }
};

/**
 * Parse MegaPay callback
 */
const parseCallback = (body = {}) => {
  const {
    ResponseCode,
    ResponseDescription,
    MerchantRequestID,
    CheckoutRequestID,
    TransactionID,
    TransactionAmount,
    TransactionReceipt,
    TransactionDate,
    TransactionReference,
    Msisdn,
  } = body;

  return {
    success: Number(ResponseCode) === 0,
    responseCode: ResponseCode,
    description: ResponseDescription,
    merchantRequestId: MerchantRequestID,
    checkoutRequestId: CheckoutRequestID,
    transactionId: TransactionID,
    amount: TransactionAmount,
    receipt: TransactionReceipt,
    date: TransactionDate,
    reference: TransactionReference,
    phone: Msisdn,
  };
};

module.exports = {
  initiateSTKPush,
  parseCallback,
};
