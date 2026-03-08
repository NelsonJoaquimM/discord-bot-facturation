const { google } = require('googleapis');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

async function getGoogleAuth() {
    console.log("--- TENTATIVE DE CONNEXION GOOGLE ---");

    let rawKey = (process.env.GOOGLE_KEY || '').trim();

    // Supprimer les guillemets éventuels autour de la clé entière
    rawKey = rawKey.replace(/^["']|["']$/g, '');

    // Convertir les \n littéraux en vrais sauts de ligne
    rawKey = rawKey.split('\\n').join('\n');

    // Extraire uniquement le contenu base64 (sans les headers)
    // pour reconstruire proprement, même si les headers sont déjà présents
    const base64Content = rawKey
        .replace(/-----BEGIN PRIVATE KEY-----/g, '')
        .replace(/-----END PRIVATE KEY-----/g, '')
        .replace(/\s+/g, '');                          // retire tous les espaces/sauts

    // Reformater le base64 en lignes de 64 caractères (format PEM standard)
    const lines = base64Content.match(/.{1,64}/g) || [];

    const privateKey = [
        '-----BEGIN PRIVATE KEY-----',
        ...lines,
        '-----END PRIVATE KEY-----',
        ''                                             // saut de ligne final obligatoire
    ].join('\n');

    // Vérification basique
    if (base64Content.length < 100) {
        console.error("⚠️ La clé semble vide ou trop courte. Vérifie la variable GOOGLE_KEY sur Render.");
        throw new Error("Clé privée invalide ou manquante");
    }

    const credentials = {
        client_email: (process.env.GOOGLE_EMAIL || '').trim(),
        private_key: privateKey,
    };

    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
    });

    try {
        const client = await auth.getClient();
        console.log("✅ AUTHENTIFICATION RÉUSSIE !");
        return client;
    } catch (err) {
        console.error("❌ ERREUR D'AUTHENTIFICATION :", err.message);
        throw err;
    }
}

module.exports = { getGoogleAuth };