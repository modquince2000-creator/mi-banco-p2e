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

    let isPaid = false;
    let batchId = null;
    let message = "Espere para recibir el pago. El sistema está procesando solicitudes."; // Default "Wait" message

    try {
        // MODO SIMULACIÓN (Si no hay claves configuradas)
        if (!clientId || !clientSecret) {
            console.log("⚠️  MODO SIMULACIÓN");
            await new Promise(resolve => setTimeout(resolve, 1500));
            batchId = "SIM_" + Date.now();
            isPaid = true;
            message = "¡Pago SIMULADO enviado!";
        }
        // MODO REAL (Si hay claves)
        else {
            console.log("💳  Intentando Pago Automático PayPal...");
            const response = await client.execute(request);
            batchId = response.result.batch_header.payout_batch_id;
            isPaid = true;
            message = "¡Pago enviado exitosamente!";
            console.log(`✅ Pago REAL procesado. ID: ${batchId}`);
        }

    } catch (err) {
        console.error("❌ Error en PayPal:", err.message);
        // NO devolvemos error (res.status(500)), devolvemos un estado de "ESPERA"
        isPaid = false;
        batchId = "PENDING_" + Date.now();
        message = "Espere para recibir el pago. (Fondos en revisión o insuficientes)";
    }

    const withdrawalData = {
        id: batchId,
        email: email,
        amount: amount,
        date: new Date(),
        paid: isPaid
    };

    allWithdrawals.unshift(withdrawalData);

    res.json({
        success: true, // La petición llegó bien al servidor
        paid: isPaid,  // Pero el pago puede haber fallado/quedado en espera
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
