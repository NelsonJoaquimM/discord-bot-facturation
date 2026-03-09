require('dotenv').config();
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { google } = require('googleapis');
const { getGoogleAuth } = require('./googleService');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ── Commandes Slash ────────────────────────────────────────────────────────────
const commands = [
    new SlashCommandBuilder()
        .setName('profil')
        .setDescription('Enregistre tes infos fixes (à faire une seule fois)'),

    new SlashCommandBuilder()
        .setName('facture')
        .setDescription('Génère une facture')
        .addStringOption(opt => opt.setName('numero').setDescription('N° de facture').setRequired(true))
        .addIntegerOption(opt => opt.setName('qte18').setDescription('Nombre de RDV à 18€').setRequired(true))
        .addIntegerOption(opt => opt.setName('qte23').setDescription('Nombre de RDV à 23€').setRequired(true))
        .addStringOption(opt => opt.setName('date').setDescription('Date (ex: 08/03/2024)').setRequired(false)),

    new SlashCommandBuilder()
        .setName('monprofil')
        .setDescription('Affiche ton profil enregistré'),

].map(c => c.toJSON());

// ── Helper : accès Sheets ──────────────────────────────────────────────────────
async function getSheetsClient() {
    const auth = await getGoogleAuth();
    return google.sheets({ version: 'v4', auth });
}

// ── Helper : récupère le profil d'un agent ─────────────────────────────────────
async function getAgentProfile(sheets, userId) {
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: process.env.SPREADSHEET_ID,
        range: 'PROFILS!A2:I',
    });
    const rows = res.data.values || [];
    return rows.find(row => row[0] === userId) || null;
}

// ── Démarrage ──────────────────────────────────────────────────────────────────
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

client.once('ready', async () => {
    try {
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
        console.log('🚀 Bot de Facturation en ligne !');
    } catch (err) {
        console.error('Erreur enregistrement commandes:', err);
    }
});

// ── Interactions ───────────────────────────────────────────────────────────────
client.on('interactionCreate', async interaction => {

    // ── /profil → Ouvre un modal en 2 étapes ──────────────────────────────────
    if (interaction.isChatInputCommand() && interaction.commandName === 'profil') {
        const modal = new ModalBuilder()
            .setCustomId('modal_profil')
            .setTitle('Mon Profil – Infos société & banque');

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('nom_societe').setLabel('Nom de la société prestataire').setStyle(TextInputStyle.Short).setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('adresse').setLabel('Adresse').setStyle(TextInputStyle.Short).setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('ville_cp').setLabel('Ville & Code Postal').setStyle(TextInputStyle.Short).setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('tel').setLabel('Téléphone').setStyle(TextInputStyle.Short).setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('email').setLabel('Email').setStyle(TextInputStyle.Short).setRequired(true)
            ),
        );

        await interaction.showModal(modal);
    }

    // ── Soumission modal profil étape 1 ───────────────────────────────────────
    if (interaction.isModalSubmit() && interaction.customId === 'modal_profil') {
        // Stocker temporairement les données dans le customId du 2ème modal
        const nom_societe = interaction.fields.getTextInputValue('nom_societe');
        const adresse     = interaction.fields.getTextInputValue('adresse');
        const ville_cp    = interaction.fields.getTextInputValue('ville_cp');
        const tel         = interaction.fields.getTextInputValue('tel');
        const email       = interaction.fields.getTextInputValue('email');

        const modal2 = new ModalBuilder()
            .setCustomId(`modal_banque|${encodeURIComponent(nom_societe)}|${encodeURIComponent(adresse)}|${encodeURIComponent(ville_cp)}|${encodeURIComponent(tel)}|${encodeURIComponent(email)}`)
            .setTitle('Mon Profil – Infos bancaires');

        modal2.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('nom_banque').setLabel('Nom de la banque').setStyle(TextInputStyle.Short).setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('adresse_banque').setLabel('Adresse de la banque').setStyle(TextInputStyle.Short).setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('rib').setLabel('RIB / IBAN').setStyle(TextInputStyle.Short).setRequired(true)
            ),
        );

        await interaction.showModal(modal2);
    }

    // ── Soumission modal banque → sauvegarde dans PROFILS ─────────────────────
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_banque|')) {
        await interaction.deferReply({ ephemeral: true });

        const parts     = interaction.customId.split('|');
        const nom_societe   = decodeURIComponent(parts[1]);
        const adresse       = decodeURIComponent(parts[2]);
        const ville_cp      = decodeURIComponent(parts[3]);
        const tel           = decodeURIComponent(parts[4]);
        const email         = decodeURIComponent(parts[5]);
        const nom_banque    = interaction.fields.getTextInputValue('nom_banque');
        const adresse_banque = interaction.fields.getTextInputValue('adresse_banque');
        const rib           = interaction.fields.getTextInputValue('rib');

        try {
            const sheets = await getSheetsClient();
            const userId = interaction.user.id;

            // Chercher si le profil existe déjà
            const res = await sheets.spreadsheets.values.get({
                spreadsheetId: process.env.SPREADSHEET_ID,
                range: 'PROFILS!A2:I',
            });
            const rows = res.data.values || [];
            const rowIndex = rows.findIndex(r => r[0] === userId);

            const newRow = [userId, nom_societe, adresse, ville_cp, tel, email, nom_banque, adresse_banque, rib];

            if (rowIndex === -1) {
                // Nouveau profil → append
                await sheets.spreadsheets.values.append({
                    spreadsheetId: process.env.SPREADSHEET_ID,
                    range: 'PROFILS!A2',
                    valueInputOption: 'USER_ENTERED',
                    resource: { values: [newRow] },
                });
            } else {
                // Mise à jour du profil existant
                await sheets.spreadsheets.values.update({
                    spreadsheetId: process.env.SPREADSHEET_ID,
                    range: `PROFILS!A${rowIndex + 2}`,
                    valueInputOption: 'USER_ENTERED',
                    resource: { values: [newRow] },
                });
            }

            await interaction.editReply('✅ **Profil sauvegardé !** Utilise `/facture` pour générer une facture.');
        } catch (err) {
            console.error('ERREUR profil:', err.message);
            await interaction.editReply('❌ Erreur lors de la sauvegarde. Regarde le terminal.');
        }
    }

    // ── /monprofil ─────────────────────────────────────────────────────────────
    if (interaction.isChatInputCommand() && interaction.commandName === 'monprofil') {
        await interaction.deferReply({ ephemeral: true });
        try {
            const sheets = await getSheetsClient();
            const agent  = await getAgentProfile(sheets, interaction.user.id);
            if (!agent) {
                return interaction.editReply('Aucun profil. Utilise `/profil` pour en créer un.');
            }
            await interaction.editReply(
                `📋 **Ton profil :**\n` +
                `**Société :** ${agent[1] || '—'}\n` +
                `**Adresse :** ${agent[2] || '—'}\n` +
                `**Ville/CP :** ${agent[3] || '—'}\n` +
                `**Tél :** ${agent[4] || '—'}\n` +
                `**Email :** ${agent[5] || '—'}\n` +
                `**Banque :** ${agent[6] || '—'}\n` +
                `**Adresse banque :** ${agent[7] || '—'}\n` +
                `**RIB :** ${agent[8] || '—'}`
            );
        } catch (err) {
            await interaction.editReply('❌ Erreur. Regarde le terminal.');
        }
    }

    // ── /facture ───────────────────────────────────────────────────────────────
    if (interaction.isChatInputCommand() && interaction.commandName === 'facture') {
        await interaction.deferReply({ ephemeral: true });

        const numFacture = interaction.options.getString('numero');
        const date       = interaction.options.getString('date') || new Date().toLocaleDateString('fr-FR');
        const qte18      = interaction.options.getInteger('qte18');
        const qte23      = interaction.options.getInteger('qte23');

        try {
            const sheets = await getSheetsClient();
            const agent  = await getAgentProfile(sheets, interaction.user.id);

            if (!agent) {
                return interaction.editReply(`⚠️ Ton profil est introuvable. Lance d'abord \`/profil\`.`);
            }

            // Dupliquer l'onglet MODELE
            const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: process.env.SPREADSHEET_ID });
            const modeleSheet = spreadsheet.data.sheets.find(s => s.properties.title === 'MODELE');
            const dupRes = await sheets.spreadsheets.batchUpdate({
                spreadsheetId: process.env.SPREADSHEET_ID,
                resource: { requests: [{ duplicateSheet: {
                    sourceSheetId: modeleSheet.properties.sheetId,
                    insertSheetIndex: spreadsheet.data.sheets.length,
                    newSheetName: numFacture + '_' + agent[1].substring(0,15),
                }}]}
            });
            const newSheet = dupRes.data.replies[0].duplicateSheet.properties.title;
            const newSheetId = dupRes.data.replies[0].duplicateSheet.properties.sheetId;

            const updates = [
                { range: newSheet + '!B2',  values: [[agent[1] || '']] },
                { range: newSheet + '!B5',  values: [[agent[2] || '']] },
                { range: newSheet + '!B6',  values: [[agent[3] || '']] },
                { range: newSheet + '!B7',  values: [[agent[4] || '']] },
                { range: newSheet + '!D5',  values: [[agent[5] || '']] },
                { range: newSheet + '!E11', values: [[numFacture]]      },
                { range: newSheet + '!E12', values: [[date]]            },
                { range: newSheet + '!C19', values: [[qte18]]           },
                { range: newSheet + '!C20', values: [[qte23]]           },
                { range: newSheet + '!B25', values: [[agent[6] || '']] },
                { range: newSheet + '!B26', values: [[agent[7] || '']] },
                { range: newSheet + '!B27', values: [[agent[8] || '']] },
            ];

            await sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: process.env.SPREADSHEET_ID,
                resource: { data: updates, valueInputOption: 'USER_ENTERED' },
            });

            const lien = `https://docs.google.com/spreadsheets/d/${process.env.SPREADSHEET_ID}/edit#gid=${newSheetId}`;
            await interaction.editReply(
                `✅ **Facture ${numFacture} générée !**\n` +
                `👤 ${agent[1]} | 📅 ${date}\n` +
                `🔗 [Voir la facture](${lien})`
            );

        } catch (err) {
            console.error('ERREUR facture:', err.message);
            await interaction.editReply('❌ Erreur lors de la génération. Regarde le terminal.');
        }
    }
});

client.on("error", err => console.error("Client error:", err.message));
client.login(process.env.DISCORD_TOKEN);