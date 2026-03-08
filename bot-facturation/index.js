cd ~/bot-facturation
node -e "
const fs = require('fs');
let code = fs.readFileSync('index.js', 'utf8');

const ancienCode = \`        try {
            const auth = await getGoogleAuth();
            const sheets = google.sheets({ version: 'v4', auth });
            const drive  = google.drive({ version: 'v3', auth });
            const agent  = await getAgentProfile(sheets, interaction.user.id);

            // Copier le modèle dans le dossier Drive
            const copie = await drive.files.copy({
                fileId: process.env.SPREADSHEET_ID,
                requestBody: {
                    name: `Facture_${numFacture}_${agent[1]}`,
                    parents: [process.env.DRIVE_FOLDER_ID],
                },
            });
            const newSpreadsheetId = copie.data.id;

            if (!agent) {
                return interaction.editReply(\\\`⚠️ Ton profil est introuvable. Lance d'abord \\\\\\\`/profil\\\\\\\`.\\\`);
            }

            // Cellules exactes de ton modèle de facture
            const updates = [
                { range: 'MODELE!B2',  values: [[agent[1] || '']] },   // Nom société
                { range: 'MODELE!B5',  values: [[agent[2] || '']] },   // Adresse
                { range: 'MODELE!B6',  values: [[agent[3] || '']] },   // Ville/CP
                { range: 'MODELE!B7',  values: [[agent[4] || '']] },   // Tel
                { range: 'MODELE!D5',  values: [[agent[5] || '']] },   // Email
                { range: 'MODELE!E11', values: [[numFacture]]       },  // N° facture
                { range: 'MODELE!E12', values: [[date]]             },  // Date facture
                { range: 'MODELE!C19', values: [[qte18]]            },  // Qty RDV 18€
                { range: 'MODELE!C20', values: [[qte23]]            },  // Qty RDV 23€
                { range: 'MODELE!B25', values: [[agent[6] || '']] },   // Nom banque
                { range: 'MODELE!B26', values: [[agent[7] || '']] },   // Adresse banque
                { range: 'MODELE!B27', values: [[agent[8] || '']] },   // RIB
            ];

            await sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: newSpreadsheetId,
                resource: { data: updates, valueInputOption: 'USER_ENTERED' },
            });

            const lien = \\\`https://docs.google.com/spreadsheets/d/\\\${process.env.SPREADSHEET_ID}/edit\\\`;
            await interaction.editReply(
                \\\`✅ **Facture \\\${numFacture} générée !**\\\\n\\\` +
                \\\`👤 \\\${agent[1]} | 📅 \\\${date}\\\\n\\\` +
                \\\`🔗 [Voir la facture](\\\${lien})\\\`
            );\`;

const nouveauCode = \`        try {
            const auth = await getGoogleAuth();
            const sheets = google.sheets({ version: 'v4', auth });
            const drive  = google.drive({ version: 'v3', auth });
            const agent  = await getAgentProfile(sheets, interaction.user.id);

            if (!agent) {
                return interaction.editReply(\\\`⚠️ Ton profil est introuvable. Lance d'abord \\\\\\\`/profil\\\\\\\`.\\\`);
            }

            // 1. Copier le modèle dans le dossier Drive
            const copie = await drive.files.copy({
                fileId: process.env.SPREADSHEET_ID,
                requestBody: {
                    name: \\\`Facture_\\\${numFacture}_\\\${agent[1]}\\\`,
                    parents: [process.env.DRIVE_FOLDER_ID],
                },
            });
            const newSpreadsheetId = copie.data.id;

            // 2. Remplir la copie
            const updates = [
                { range: 'MODELE!B2',  values: [[agent[1] || '']] },
                { range: 'MODELE!B5',  values: [[agent[2] || '']] },
                { range: 'MODELE!B6',  values: [[agent[3] || '']] },
                { range: 'MODELE!B7',  values: [[agent[4] || '']] },
                { range: 'MODELE!D5',  values: [[agent[5] || '']] },
                { range: 'MODELE!E11', values: [[numFacture]]      },
                { range: 'MODELE!E12', values: [[date]]            },
                { range: 'MODELE!C19', values: [[qte18]]           },
                { range: 'MODELE!C20', values: [[qte23]]           },
                { range: 'MODELE!B25', values: [[agent[6] || '']] },
                { range: 'MODELE!B26', values: [[agent[7] || '']] },
                { range: 'MODELE!B27', values: [[agent[8] || '']] },
            ];

            await sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: newSpreadsheetId,
                resource: { data: updates, valueInputOption: 'USER_ENTERED' },
            });

            const lien = \\\`https://docs.google.com/spreadsheets/d/\\\${newSpreadsheetId}/edit\\\`;
            await interaction.editReply(
                \\\`✅ **Facture \\\${numFacture} générée !**\\\\n\\\` +
                \\\`👤 \\\${agent[1]} | 📅 \\\${date}\\\\n\\\` +
                \\\`🔗 [Voir la facture](\\\${lien})\\\`
            );\`;

code = code.replace(ancienCode, nouveauCode);
fs.writeFileSync('index.js', code);
console.log('✅ Fait !');
"