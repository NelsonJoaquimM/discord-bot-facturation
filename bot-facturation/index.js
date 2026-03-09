require('dotenv').config();
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { google } = require('googleapis');
const { getGoogleAuth } = require('./googleService');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

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

async function getSheetsClient() {
    const auth = await getGoogleAuth();
    return google.sheets({ version: 'v4', auth });
}

async function getAgentProfile(sheets, userId) {
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: process.env.SPREADSHEET_ID,
        range: 'PROFILS!A2:I',
    });
    const rows = res.data.values || [];
    return rows.find(row => row[0] === userId) || null;
}

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

client.once('ready', async () => {
    try {
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
        console.log('🚀 Bot de Facturation en ligne !');
    } catch (err) {
        console.error('Erreur enregistrement commandes:', err);
    }
});

client.on('error', err => console.error('Client error:', err.message));

client.on('interactionCreate', async interaction => {

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

    if (interaction.isModalSubmit() && interaction.customId === 'modal_profil') {
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

    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_banque|')) {
        await interaction.deferReply({ ephemeral: true });
        const parts          = interaction.customId.split('|');
        const nom_societe    = decodeURIComponent(parts[1]);
        const adresse        = decodeURIComponent(parts[2]);
        const ville_cp       = decodeURIComponent(parts[3]);
        const tel            = decodeURIComponent(parts[4]);
        const email          = decodeURIComponent(parts[5]);
        const nom_banque     = interaction.fields.getTextInputValue('nom_banque');
        const adresse_banque = interaction.fields.getTextInputValue('adresse_banque');
        const rib            = interaction.fields.getTextInputValue('rib');
        try {
            const sheets  = await getSheetsClient();
            const userId  = interaction.user.id;
            const res     = await sheets.spreadsheets.values.get({
                spreadsheetId: process.env.SPREADSHEET_ID,
                range: 'PROFILS!A2:I',
            });
            const rows     = res.data.values || [];
            const rowIndex = rows.findIndex(r => r[0] === userId);
            const newRow   = [userId, nom_societe, adresse, ville_cp, tel, email, nom_banque, adresse_banque, rib];
            if (rowIndex === -1) {
                await sheets.spreadsheets.values.append({
                    spreadsheetId: process.env.SPREADSHEET_ID,
                    range: 'PROFILS!A2',
                    valueInputOption: 'USER_ENTERED',
                    resource: { values: [newRow] },
                });
            } else {
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

    if (interaction.isChatInputCommand() && interaction.commandName === 'monprofil') {
        await interaction.deferReply({ ephemeral: true });
        try {
            const sheets = await getSheetsClient();
            const agent  = await getAgentProfile(sheets, interaction.user.id);
            if (!agent) return interaction.editReply('Aucun profil. Utilise `/profil` pour en créer un.');
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

    if (interaction.isChatInputCommand() && interaction.commandName === 'facture') {
        await interaction.deferReply({ ephemeral: true });
        const numFacture = interaction.options.getString('numero');
        const date       = interaction.options.getString('date') || new Date().toLocaleDateString('fr-FR');
        const qte18      = interaction.options.getInteger('qte18');
        const qte23      = interaction.options.getInteger('qte23');
        try {
            const auth   = await getGoogleAuth();
            const sheets = google.sheets({ version: 'v4', auth });
            const drive  = google.drive({ version: 'v3', auth });
            const agent  = await getAgentProfile(sheets, interaction.user.id);
            if (!agent) return interaction.editReply(`⚠️ Ton profil est introuvable. Lance d'abord \`/profil\`.`);

            // Copier le modèle dans le dossier Drive
            const copie = await drive.files.copy({
                fileId: process.env.SPREADSHEET_ID,
                requestBody: {
                    name: `Facture_${numFacture}_${agent[1]}`,
                    parents: [process.env.DRIVE_FOLDER_ID],
                },
            });
            const newId = copie.data.id;

            // Transférer propriété au vrai compte Google
            const driveClient = google.drive({ version: "v3", auth });
            await driveClient.permissions.create({
                fileId: newId,
                transferOwnership: true,
                requestBody: { role: "owner", type: "user", emailAddress: process.env.OWNER_EMAIL },
            });

            // Remplir la copie
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
                spreadsheetId: newId,
                resource: { data: updates, valueInputOption: 'USER_ENTERED' },
            });

            const lien = `https://docs.google.com/spreadsheets/d/${newId}/edit`;
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

client.login(process.env.DISCORD_TOKEN);
