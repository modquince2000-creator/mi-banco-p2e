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

    // 3. Crear Petición de Payout a PayPal
    const request = new paypal.payouts.PayoutsPostRequest();
    request.requestBody({
        "sender_batch_header": {
            "sender_batch_id": "Payout_" + Date.now(),
            "email_subject": "¡Has recibido tu pago de AdRewards!",
            "email_message": "Gracias por usar nuestra app. Aquí tienes tus ganancias."
        },
        "items": [
            {
                "recipient_type": "EMAIL",
                "amount": {
                    "value": amount.toString(),
                    "currency": "EUR"
                },
                "note": "Retiro de ganancias AdRewards",
                "receiver": email, // El email de PayPal del usuario
                "sender_item_id": "item_" + Date.now()
            }
        ]
    });

    let batchId = "MANUAL_REVIEW_" + Date.now();
    let status = "PENDING_MANUAL_REVIEW";
    let message = "Solicitud recibida. Procesaremos tu pago manualmente."; // Fallback message

    try {
        // MODO SIMULACIÓN (Si no hay claves configuradas)
        if (!clientId || !clientSecret) {
            console.log("⚠️  MODO SIMULACIÓN: Credenciales no encontradas.");
            console.log("💫  Simulando pago exitoso a PayPal...");
            await new Promise(resolve => setTimeout(resolve, 1500));
            batchId = "SIMULATED_BATCH_" + Date.now();
            status = "PAID_SIMULATION";
            message = "Pago SIMULADO enviado.";
        }
        // MODO REAL (Si hay claves)
        else {
            console.log("💳  Conectando con PayPal Real...");
            const response = await client.execute(request);
            batchId = response.result.batch_header.payout_batch_id;
            status = "PAID_AUTOMATIC";
            message = "¡Pago enviado exitosamente!";
            console.log(`✅ Pago procesado exitosamente. ID: ${batchId}`);
        }

    } catch (err) {
        console.error("❌ Error en PayPal (Se pasará a Manual):", err.message);
        // NO devolvemos error 500, sino que lo guardamos como MANUAL
        status = "FAILED_AUTO_QUEUED_MANUAL";
        message = "Hubo un problema técnico con PayPal, pero tu solicitud ha sido guardada. Te pagaremos manualmente en breve.";
    }

    const withdrawalData = {
        id: batchId,
        email: email,
        userEmail: req.body.userEmail || email,
        amount: amount,
        date: new Date(),
        status: status
    };

    // GUARDAR EN MEMORIA (Admin View)
    allWithdrawals.unshift(withdrawalData);
    console.log("💰 NUEVO RETIRO (Guardado):", withdrawalData);

    // Siempre devolvemos success al usuario para que no se asuste, 
    // pero el mensaje le explica si fue auto o manual.
    res.json({
        success: true,
        message: message,
        batch_id: batchId
    });
});

// --- ADMIN ENDPOINT (Para ti) ---
// Entra a: https://tu-url.com/api/admin?pass=admin123
app.get('/api/admin', (req, res) => {
    if (req.query.pass !== 'admin123') return res.status(403).send("Acceso Denegado");

    let html = `<h1>Panel de Administración</h1><table border='1' style='width:100%; border-collapse:collapse;'>
    <tr><th>Fecha</th><th>Email PayPal</th><th>Monto</th><th>Estado</th></tr>`;

    allWithdrawals.forEach(w => {
        html += `<tr>
            <td>${w.date.toLocaleString()}</td>
            <td>${w.email}</td>
            <td>€${w.amount}</td>
            <td>${w.status}</td>
        </tr>`;
    });

    html += "</table>";
    res.send(html);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor Backend corriendo en http://localhost:${PORT}`);
    console.log(`Modo: ${process.env.PAYPAL_CLIENT_ID ? 'Configurado' : 'Sin Credenciales (Simulación)'}`);
});
