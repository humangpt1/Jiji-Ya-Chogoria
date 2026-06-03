const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
    if (!transporter && process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
        transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.GMAIL_USER,
                pass: process.env.GMAIL_APP_PASSWORD
            }
        });
    }
    return transporter;
}

async function sendPasswordResetEmail(toEmail, toName, resetToken) {
    const t = getTransporter();
    if (!t) {
        console.warn('[Email] Service not configured — skipping password reset email.');
        return false;
    }

    const base = process.env.APP_URL ||
        (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` :
        'https://jijichogoria.co.ke');
    const resetUrl = `${base}/?token=${resetToken}`;

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    body{font-family:'Helvetica Neue',Arial,sans-serif;background:#0a0a0a;color:#fff;margin:0;padding:0}
    .wrap{max-width:560px;margin:0 auto;padding:32px 16px}
    .logo{text-align:center;margin-bottom:28px}
    .logo-icon{display:inline-block;background:linear-gradient(135deg,#ff6b35,#ff8c42);border-radius:14px;padding:14px 22px;font-size:1.6rem}
    .logo-name{color:#ff6b35;font-size:1.15rem;font-weight:800;margin-top:10px;letter-spacing:-0.3px}
    .card{background:#111;border:1px solid #222;border-radius:16px;padding:36px 32px;text-align:center}
    .icon{font-size:2.8rem;margin-bottom:14px}
    .title{font-size:1.35rem;font-weight:800;margin-bottom:10px}
    .sub{color:#aaa;font-size:0.88rem;line-height:1.7;margin-bottom:28px}
    .btn{display:inline-block;background:linear-gradient(135deg,#ff6b35,#ff8c42);color:#fff;text-decoration:none;padding:14px 36px;border-radius:30px;font-weight:700;font-size:0.95rem}
    hr{border:none;border-top:1px solid #222;margin:28px 0}
    .url-box{background:#1a1a1a;border:1px solid #333;border-radius:8px;padding:12px;font-size:0.73rem;color:#666;word-break:break-all;margin-top:14px}
    .warn{background:rgba(255,75,75,.1);border:1px solid rgba(255,75,75,.2);border-radius:8px;padding:12px 16px;font-size:0.82rem;color:#ff6b6b;margin-top:20px;text-align:left}
    .footer{text-align:center;margin-top:28px;font-size:0.76rem;color:#555}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="logo">
      <div class="logo-icon">🏪</div>
      <div class="logo-name">Jiji ya Chogoria</div>
    </div>
    <div class="card">
      <div class="icon">🔐</div>
      <div class="title">Reset Your Password</div>
      <div class="sub">Hi <strong>${toName}</strong>! You requested a password reset.<br>This link expires in <strong style="color:#ff6b35">1 hour</strong>.</div>
      <a href="${resetUrl}" class="btn">🔑 Reset Password</a>
      <hr>
      <div style="font-size:0.8rem;color:#666">If the button doesn't work, copy this link:</div>
      <div class="url-box">${resetUrl}</div>
      <div class="warn">⚠️ If you didn't request this, ignore this email. Your password won't change.</div>
    </div>
    <div class="footer">&copy; 2025 Jiji ya Chogoria · Chogoria, Tharaka-Nithi<br>Sent to ${toEmail}</div>
  </div>
</body>
</html>`;

    try {
        await t.sendMail({
            from: `"Jiji ya Chogoria" <${process.env.GMAIL_USER}>`,
            to: toEmail,
            subject: '🔐 Reset Your Jiji ya Chogoria Password',
            html
        });
        return true;
    } catch (err) {
        console.error('[Email] Send error:', err.message);
        return false;
    }
}

module.exports = { sendPasswordResetEmail };
