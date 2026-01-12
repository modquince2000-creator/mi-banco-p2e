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

    try {
        let batchId;

        // MODO SIMULACIÓN (Si no hay claves configuradas)
        if (!clientId || !clientSecret) {
            console.log("⚠️  MODO SIMULACIÓN: Credenciales no encontradas.");
            console.log("💫  Simulando pago exitoso a PayPal...");

            // Simular retardo de red
            await new Promise(resolve => setTimeout(resolve, 1500));

            batchId = "SIMULATED_BATCH_" + Date.now();
        }
        // MODO REAL (Si hay claves)
        else {
            console.log("💳  Conectando con PayPal Real...");
            const response = await client.execute(request);
            batchId = response.result.batch_header.payout_batch_id;
        }

        console.log(`✅ Pago procesado exitosamente. ID: ${batchId}`);

        // 5. Descontar Saldo en DB
        // await db.users.update({email}, {$inc: {balance: -amount}});

        res.json({
            success: true,
            status: "SCHEDULED",
            message: "Solicitud recibida. El pago se procesará el día 5 del próximo mes.",
            batch_id: batchId
        });

    } catch (err) {
        console.error("Error en PayPal:", err);
        res.status(500).json({ error: "Error procesando el pago con PayPal", details: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor Backend corriendo en http://localhost:${PORT}`);
    console.log(`Modo: ${process.env.PAYPAL_CLIENT_ID ? 'Configurado' : 'Sin Credenciales (Simulación)'}`);
});
