const express = require('express'); // npm install express
const paypal = require('@paypal/payouts-sdk'); // npm install @paypal/payouts-sdk
const cors = require('cors'); // npm install cors
const dotenv = require('dotenv'); // npm install dotenv

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

// --- CONFIGURACIÓN DE PAYPAL ---
// NO pongas tus claves aquí directamente. Contrálas en el archivo .env
const clientId = process.env.PAYPAL_CLIENT_ID;
const clientSecret = process.env.PAYPAL_SECRET;
const environment = new paypal.core.SandboxEnvironment(clientId, clientSecret);
// Cambiar a LiveEnvironment para producción:
// const environment = new paypal.core.LiveEnvironment(clientId, clientSecret);
const client = new paypal.core.PayPalHttpClient(environment);

// Simularemos una Base de Datos aquí
// En producción, usa MongoDB, Firestore o MySQL
const usersDB = {
    'user@example.com': { balance: 5.00, walletId: 'sb-user123@business.example.com' }
};

// Base de Datos en Memoria (Se borra si reinicias el servidor)
const allWithdrawals = [];

// AVISO DEL SISTEMA (Lo que ven los usuarios)
let systemNotice = {
    message: "Pagos activos. ¡Retira tus ganancias hoy mismo!",
    type: "success" // success (verde), warning (naranja), info (azul)
};

// --- FUNCIÓN CENTRAL DE PAGO (Auto-Reintentable) ---
async function executePayPalPayout(email, amount) {
    const request = new paypal.payouts.PayoutsPostRequest();
    request.requestBody({
        "sender_batch_header": {
            "sender_batch_id": "Payout_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
            "email_subject": "¡Has recibido tu pago de AdRewards!",
            "email_message": "Gracias por usar nuestra app. Aquí tienes tus ganancias."
        },
        "items": [{
            "recipient_type": "EMAIL",
            "amount": { "value": amount.toString(), "currency": "EUR" },
            "note": "Retiro de ganancias AdRewards",
            "receiver": email,
            "sender_item_id": "item_" + Date.now()
        }]
    });

    try {
        if (!clientId || !clientSecret) {
            return { success: true, batchId: "SIM_" + Date.now(), message: "¡Pago SIMULADO enviado!" };
        }
        const response = await client.execute(request);
        return { success: true, batchId: response.result.batch_header.payout_batch_id, message: "¡Pago enviado exitosamente!" };
    } catch (err) {
        console.error(`❌ Error PayPal para ${email}:`, err.message);
        return { success: false, message: "Fondos insuficientes o error técnico." };
    }
}

// --- WORKER DE AUTO-PAGO (Corre cada 10 minutos) ---
async function backgroundPayoutWorker() {
    console.log("🤖 Worker: Revisando pagos pendientes...");
    let anySuccess = false;
    let anyPending = false;

    for (let w of allWithdrawals) {
        if (!w.paid) {
            anyPending = true;
            console.log(`⏳ Reintentando pago para: ${w.email} (€${w.amount})`);
            const result = await executePayPalPayout(w.email, w.amount);
            
            if (result.success) {
                w.paid = true;
                w.id = result.batchId;
                anySuccess = true;
                console.log(`✅ Pago exitoso para ${w.email} vía Worker.`);
            }
        }
    }

    // Actualizar Aviso Automáticamente
    if (anySuccess) {
        systemNotice.message = "🟢 Pagos activos. ¡Retira tus ganancias hoy mismo!";
        systemNotice.type = "success";
    } else if (anyPending) {
        systemNotice.message = "🟡 Retiros en espera. Recargando fondos automáticos...";
        systemNotice.type = "warning";
    }
}

// Iniciar worker (600000ms = 10 minutos)
setInterval(backgroundPayoutWorker, 600000);

// --- ENDPOINT DE RETIRO ---
app.post('/api/withdraw', async (req, res) => {
    const { email, amount } = req.body;

    // 1. Validaciones Básicas
    if (!email || !amount) return res.status(400).json({ error: "Faltan datos" });
    if (amount < 1.00) return res.status(400).json({ error: "Mínimo de retiro es 1€" });

    // 2. Verificar Saldo del Usuario (Simulado)
    const user = usersDB[email]; // Aquí consultarías tu DB real
    // En el prototipo, asumimos que todos tienen saldo si el frontend lo dice (INSEGURO - SOLO DEMO)
    // if (!user || user.balance < amount) {
    //    return res.status(403).json({ error: "Saldo insuficiente" });
    // }

    console.log(`Procesando retiro de €${amount} para ${email}...`);

    const result = await executePayPalPayout(email, amount);
    
    const withdrawalData = {
        id: result.batchId || "PENDING_" + Date.now(),
        email: email,
        amount: amount,
        date: new Date(),
        paid: result.success
    };

    allWithdrawals.unshift(withdrawalData);

    // Si el pago falla al primer intento, ponemos aviso naranja
    if (!result.success) {
        systemNotice.message = "🟡 Retiros temporalmente en espera. Recargando fondos...";
        systemNotice.type = "warning";
    }

    res.json({
        success: true,
        paid: result.success,
        message: result.success ? result.message : "Espere para recibir el pago. (Fondos en revisión)",
        batch_id: withdrawalData.id
    });
});

// --- ADMIN ENDPOINT (Para ti) ---
app.get('/api/admin', (req, res) => {
    if (req.query.pass !== 'admin123') return res.status(403).send("Acceso Denegado");

    let html = `<h1>Panel de Administración</h1>
    <p>Estado actual para usuarios: <strong>${systemNotice.message}</strong></p>
    <a href="/api/update-notice?pass=admin123&msg=🟢%20Retiros%20PayPal%20disponibles&type=success" style="background:green; color:white; padding:10px; text-decoration:none; border-radius:5px;">ACTIVAR PAGOS (Recargado)</a>
    <br><br>
    <table border='1' style='width:100%; border-collapse:collapse;'>
    <tr><th>Fecha</th><th>Email PayPal</th><th>Monto</th><th>Estado Real</th></tr>`;

    allWithdrawals.forEach(w => {
        html += `<tr>
            <td>${w.date.toLocaleString()}</td>
            <td>${w.email}</td>
            <td>€${w.amount}</td>
            <td>${w.paid ? 'PAGADO' : 'FALLÓ (SIN SALDO)'}</td>
        </tr>`;
    });

    html += "</table>";
    res.send(html);
});

// --- ENDPOINTS PARA EL AVISO ---
app.get('/api/notice', (req, res) => {
    res.json(systemNotice);
});

// Actualizar manualmente: /api/update-notice?pass=admin123&msg=LoQueQuieras&type=warning
app.get('/api/update-notice', (req, res) => {
    if (req.query.pass !== 'admin123') return res.status(403).send("Acceso Denegado");
    if (req.query.msg) systemNotice.message = req.query.msg;
    if (req.query.type) systemNotice.type = req.query.type;
    res.send(`<h1>Aviso Actualizado</h1><p>${systemNotice.message}</p><a href="/api/admin?pass=admin123">Volver al Panel</a>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor Backend corriendo en http://localhost:${PORT}`);
    console.log(`Modo: ${process.env.PAYPAL_CLIENT_ID ? 'Configurado' : 'Sin Credenciales (Simulación)'}`);
});
