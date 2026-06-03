const axios = require('axios');

const MPESA_BASE_URL = process.env.MPESA_ENV === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';

const getAccessToken = async () => {
    const credentials = Buffer.from(
        `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
    ).toString('base64');

    const response = await axios.get(`${MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
        headers: { Authorization: `Basic ${credentials}` }
    });

    return response.data.access_token;
};

const generatePassword = () => {
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    const raw = `${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`;
    const password = Buffer.from(raw).toString('base64');
    return { password, timestamp };
};

const initiateSTKPush = async ({ phone, amount, accountReference, transactionDesc }) => {
    const accessToken = await getAccessToken();
    const { password, timestamp } = generatePassword();

    const formattedPhone = phone.replace(/^0/, '254').replace(/^\+/, '');

    const payload = {
        BusinessShortCode: process.env.MPESA_SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: Math.ceil(amount),
        PartyA: formattedPhone,
        PartyB: process.env.MPESA_SHORTCODE,
        PhoneNumber: formattedPhone,
        CallBackURL: process.env.MPESA_CALLBACK_URL,
        AccountReference: accountReference || 'JijiYaChogoria',
        TransactionDesc: transactionDesc || 'Membership Payment'
    };

    const response = await axios.post(
        `${MPESA_BASE_URL}/mpesa/stkpush/v1/processrequest`,
        payload,
        { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    return response.data;
};

const querySTKStatus = async (checkoutRequestId) => {
    const accessToken = await getAccessToken();
    const { password, timestamp } = generatePassword();

    const response = await axios.post(
        `${MPESA_BASE_URL}/mpesa/stkpushquery/v1/query`,
        {
            BusinessShortCode: process.env.MPESA_SHORTCODE,
            Password: password,
            Timestamp: timestamp,
            CheckoutRequestID: checkoutRequestId
        },
        { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    return response.data;
};

module.exports = { initiateSTKPush, querySTKStatus, getAccessToken };
