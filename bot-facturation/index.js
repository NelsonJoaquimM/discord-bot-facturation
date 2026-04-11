require('dotenv').config();
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { google }              = require('googleapis');
const { getGoogleAuth }       = require('./googleService');
const { genererFacturesAuto } = require('./autoFacture');
const cron                    = require('node-cron');

const NOTIF_CHANNEL_ID = '1480592125673341278';

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ── Commandes Slash ────────────────────────────────────────────────────────────
const commands = [
    new SlashCommandBuilder()
        .setName('profil')
        .setDescription('Enregistre tes infos fixes (à faire une seule fois)'),

    new SlashCommandBuilder()
        .setName('facture')
        .setDescription('Génère une facture manuellement')
        .addStringOption(opt => opt.setName('numero').setDescription('N° de facture').setRequired(true))
        .addIntegerOption(opt => opt.setName('qte1').setDescription('Nombre de RDV ligne 1').setRequired(true))
        .addStringOption(opt => opt.setName('tarif').setDescription('Tarif ligne 1').addChoices({name: '18€', value: '18'}, {name: '17.50€', value: '17.5'}).setRequired(true))
        .addIntegerOption(opt => opt.setName('qte50plus').setDescription('Nombre de RDV (si +50 RDV)').setRequired(true))
        .addStringOption(opt => opt.setName('tarifplus').setDescription('Tarif ligne 2').addChoices({name: '23€', value: '23'}, {name: '22.50€', value: '22.5'}).setRequired(true))
        .addStringOption(opt => opt.setName('date').setDescription('Date (ex: 08/03/2024)').setRequired(false))
        .addStringOption(opt => opt.setName('ligne').setDescription('Déduire 49€ ligne ON/OFF ?').addChoices({name: 'Oui', value: 'oui'}, {name: 'Non', value: 'non'}).setRequired(false)),

    new SlashCommandBuilder()
        .setName('monprofil')
        .setDescription('Affiche ton profil enregistré'),

    new SlashCommandBuilder()
        .setName('generer-factures')
        .setDescription('⚙️ [ADMIN] Déclenche la génération automatique des factures maintenant'),

].map(c => c.toJSON());

// ── Helpers ────────────────────────────────────────────────────────────────────
async function getSheetsClient() {
    const auth = await getGoogleAuth();
    return google.sheets({ version: 'v4', auth });
}

async function getAgentProfile(sheets, userId) {
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: process.env.SPREADSHEET_ID,
        range: 'PROFILS!A2:L',
    });
    const rows = res.data.values || [];
    return rows.find(row => row[0] === userId) || null;
}

// ── Notification Discord ───────────────────────────────────────────────────────
async function envoyerNotifFactures(resultats, nomDossier) {
    const channel = await client.channels.fetch(NOTIF_CHANNEL_ID);
    if (!channel) return;

    const ok   = resultats.filter(r => r.startsWith('✅')).length;
    const err  = resultats.filter(r => r.startsWith('❌')).length;
    const warn = resultats.filter(r => r.startsWith('⚠️')).length;

    const message =
        `## 🧾 Génération automatique — ${nomDossier}\n` +
        `✅ ${ok} factures générées | ❌ ${err} erreurs | ⚠️ ${warn} introuvables\n\n` +
        resultats.join('\n');

    // Découper si message trop long
    const chunks = [];
    let chunk = '';
    for (const line of message.split('\n')) {
        if ((chunk + line).length > 1900) { chunks.push(chunk); chunk = ''; }
        chunk += line + '\n';
    }
    if (chunk) chunks.push(chunk);
    for (const c of chunks) await channel.send(c);
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

    // ── CRON : chaque 8 du mois à 08h00 heure Paris ───────────────────────────
    cron.schedule('0 8 8 * *', async () => {
        console.log('⏰ Déclenchement automatique des factures...');
        try {
            const { resultats, nomDossier } = await genererFacturesAuto();
            await envoyerNotifFactures(resultats, nomDossier);
        } catch (err) {
            console.error('Erreur cron factures:', err.message);
        }
    }, { timezone: 'Europe/Paris' });

    console.log('📅 Cron activé — génération le 8 de chaque mois à 08h00');
});

// ── Interactions ───────────────────────────────────────────────────────────────
client.on('interactionCreate', async interaction => {

    // ── /profil ────────────────────────────────────────────────────────────────
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
            const sheets = await getSheetsClient();
            const userId = interaction.user.id;

            const res      = await sheets.spreadsheets.values.get({
                spreadsheetId: process.env.SPREADSHEET_ID,
                range: 'PROFILS!A2:L',
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
            console.error('ERREUR monprofil:', err.message);
            await interaction.editReply('❌ Erreur. Regarde le terminal.');
        }
    }

    // ── /facture (manuel) ──────────────────────────────────────────────────────
    if (interaction.isChatInputCommand() && interaction.commandName === 'facture') {
        console.log('📩 Commande facture reçue !');
        await interaction.deferReply({ ephemeral: true });

        const numFacture = interaction.options.getString('numero');
        const date       = interaction.options.getString('date') || new Date().toLocaleDateString('fr-FR');
        const qte18      = interaction.options.getInteger('qte1');
        const qte50plus3 = interaction.options.getInteger('qte50plus');
        const ligne      = interaction.options.getString('ligne') || 'non';
        const tarif      = interaction.options.getString('tarif');
        const tarifplus  = interaction.options.getString('tarifplus');

        try {
            const sheets = await getSheetsClient();
            const agent  = await getAgentProfile(sheets, interaction.user.id);

            if (!agent) {
                return interaction.editReply(`⚠️ Ton profil est introuvable. Lance d'abord \`/profil\`.`);
            }

            const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: process.env.SPREADSHEET_ID });
            const modeleSheet = spreadsheet.data.sheets.find(s => s.properties.title === 'MODELE');
            const nomOnglet   = numFacture + '-' + agent[1].substring(0, 10).replace(/ /g, '-') + '-' + date.split('/').slice(1).join('-');

            const dupRes = await sheets.spreadsheets.batchUpdate({
                spreadsheetId: process.env.SPREADSHEET_ID,
                resource: { requests: [{ duplicateSheet: {
                    sourceSheetId:    modeleSheet.properties.sheetId,
                    insertSheetIndex: spreadsheet.data.sheets.length,
                    newSheetName:     nomOnglet,
                }}]}
            });
            const newSheet   = dupRes.data.replies[0].duplicateSheet.properties.title;
            const newSheetId = dupRes.data.replies[0].duplicateSheet.properties.sheetId;

            await sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: process.env.SPREADSHEET_ID,
                resource: {
                    valueInputOption: 'USER_ENTERED',
                    data: [
                        { range: newSheet + '!B2',  values: [[agent[1] || '']] },
                        { range: newSheet + '!B5',  values: [[agent[2] || '']] },
                        { range: newSheet + '!B6',  values: [[agent[3] || '']] },
                        { range: newSheet + '!B7',  values: [[agent[4] || '']] },
                        { range: newSheet + '!D5',  values: [[agent[5] || '']] },
                        { range: newSheet + '!E11', values: [[numFacture]]      },
                        { range: newSheet + '!E12', values: [[date]]            },
                        { range: newSheet + '!C19', values: [[qte18]]           },
                        { range: newSheet + '!D19', values: [[parseFloat(tarif)]]      },
                        { range: newSheet + '!C20', values: [[qte50plus3]]      },
                        { range: newSheet + '!D20', values: [[parseFloat(tarifplus)]]  },
                        { range: newSheet + '!B25', values: [[agent[6] || '']] },
                        { range: newSheet + '!B26', values: [[agent[7] || '']] },
                        { range: newSheet + '!B27', values: [[agent[8] || '']] },
                        { range: newSheet + '!B21', values: [[ligne === 'oui' ? 'Ligne ON/OFF' : '']] },
                        { range: newSheet + '!E21', values: [[ligne === 'oui' ? -49 : '']]            },
                    ],
                },
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

    // ── /generer-factures (admin) ──────────────────────────────────────────────
    if (interaction.isChatInputCommand() && interaction.commandName === 'generer-factures') {
        await interaction.deferReply({ ephemeral: true });
        await interaction.editReply('⏳ Génération en cours... La notification arrivera dans le salon dédié.');

        try {
            const { resultats, nomDossier } = await genererFacturesAuto();
            await envoyerNotifFactures(resultats, nomDossier);
        } catch (err) {
            console.error('ERREUR generer-factures:', err.message);
            const channel = await client.channels.fetch(NOTIF_CHANNEL_ID);
            if (channel) channel.send(`❌ Erreur génération auto: ${err.message}`);
        }
    }
});

client.on('error', err => console.error('Client error:', err.message));
client.login(process.env.DISCORD_TOKEN);
