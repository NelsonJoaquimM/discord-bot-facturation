const { google } = require('googleapis');
const { getGoogleAuth } = require('./googleService');
const { Readable } = require('stream');

const SPREADSHEET_ID  = process.env.SPREADSHEET_ID;
const DRIVE_FOLDER_ID = process.env.DRIVE_FOLDER_ID;
const STATS_SHEET     = 'STATS DATA';

const HICHAM_SDR = 'Hicham ELMOUSSAID';
const JIHANE_SDR = 'Jihane ENNACERIE';

const MONTH_NAMES = {
  1:'01-JANUARY', 2:'02-FEBRUARY', 3:'03-MARCH',    4:'04-APRIL',
  5:'05-MAY',     6:'06-JUNE',     7:'07-JULY',      8:'08-AUGUST',
  9:'09-SEPTEMBER',10:'10-OCTOBER',11:'11-NOVEMBER',12:'12-DECEMBER'
};

async function genererFacturesAuto() {
  const auth   = await getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const drive  = google.drive({ version: 'v3', auth });

  // ── Mois facturé = mois précédent ─────────────────────────────────────────
  const now         = new Date();
  const moisNum     = now.getMonth() === 0 ? 12 : now.getMonth();
  const annee       = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const anneeShort  = String(annee).slice(2);
  const dateFacture = `08/${String(moisNum).padStart(2,'0')}/${annee}`;

  // ── Lire PROFILS ──────────────────────────────────────────────────────────
  const profilsRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'PROFILS!A2:L',
  });
  const profils = (profilsRes.data.values || []).filter(p => p[11]);
  console.log(`${profils.length} agents trouvés dans PROFILS`);

  // ── Lire STATS DATA ───────────────────────────────────────────────────────
  const statsRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${STATS_SHEET}!A:O`,
  });
  const statsRows = statsRes.data.values || [];
  console.log(`${statsRows.length} lignes trouvées dans STATS DATA`);

  // ── Calculer totaux VENU équipe ───────────────────────────────────────────
  let totalVenuEquipe = 0;
  let venuHicham      = 0;

  for (const profil of profils) {
    const nomSdr  = profil[11].trim();
    const statRow = statsRows.find(r => r[0] && r[0].trim() === nomSdr);
    if (!statRow) continue;
    const venu = parseInt(statRow[5]) || 0;
    totalVenuEquipe += venu;
    if (nomSdr === HICHAM_SDR) venuHicham = venu;
  }
  const venuSansHicham = totalVenuEquipe - venuHicham;
  console.log(`Total VENU équipe: ${totalVenuEquipe} | Hicham: ${venuHicham} | Sans Hicham: ${venuSansHicham}`);

  // ── Trouver/créer le dossier Drive du mois ────────────────────────────────
  const nomDossier = `${MONTH_NAMES[moisNum]} ${annee}`;
  const driveRes   = await drive.files.list({
    q: `'${DRIVE_FOLDER_ID}' in parents and name='${nomDossier}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id,name)',
  });
  let dossierMoisId;
  if (driveRes.data.files.length > 0) {
    dossierMoisId = driveRes.data.files[0].id;
  } else {
    const newFolder = await drive.files.create({
      resource: { name: nomDossier, mimeType: 'application/vnd.google-apps.folder', parents: [DRIVE_FOLDER_ID] },
      fields: 'id',
    });
    dossierMoisId = newFolder.data.id;
  }
  console.log(`Dossier Drive: ${nomDossier}`);

  // ── Récupérer le sheetId du MODELE ────────────────────────────────────────
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const modeleSheet = spreadsheet.data.sheets.find(s => s.properties.title === 'MODELE');

  // ── Générer une facture par agent ─────────────────────────────────────────
  const resultats = [];

  for (const profil of profils) {
    const nomSdr  = profil[11].trim();
    const nomSte  = profil[1] || nomSdr;
    const statRow = statsRows.find(r => r[0] && r[0].trim() === nomSdr);

    if (!statRow) {
      console.log(`⚠️ ${nomSdr} introuvable dans STATS DATA`);
      resultats.push(`⚠️ **${nomSdr}** — introuvable dans les stats`);
      continue;
    }

    const venu = parseInt(statRow[5]) || 0;
    console.log(`${nomSdr} → ${venu} RDV VENU`);

    let qte1 = venu, tarif1 = 17.5;
    let qte2 = 0,    tarif2 = 0;
    let bonusLabel = '', bonusVal = '';

    if (nomSdr === HICHAM_SDR) {
      tarif1     = venu > 50 ? 23 : 18;
      bonusLabel = `Bonus equipe (${totalVenuEquipe} RDV x 0,50EUR)`;
      bonusVal   = +(totalVenuEquipe * 0.5).toFixed(2);
    } else if (nomSdr === JIHANE_SDR) {
      qte1       = 1;
      tarif1     = 150;
      bonusLabel = `Bonus equipe (${venuSansHicham} RDV x 0,50EUR)`;
      bonusVal   = +(venuSansHicham * 0.5).toFixed(2);
    } else {
      tarif1 = venu > 50 ? 22.5 : 17.5;
    }

    const suffix     = nomSdr.split(' ').pop().substring(0, 6).toUpperCase();
    const numFacture = `${String(moisNum).padStart(2,'0')}${anneeShort}-${suffix}`;
    const nomOnglet  = `${numFacture}-${nomSte.substring(0,12).replace(/ /g,'-')}`;

    try {
      const totalSheets = (await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID })).data.sheets.length;
      const dupRes = await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: { requests: [{ duplicateSheet: {
          sourceSheetId:    modeleSheet.properties.sheetId,
          insertSheetIndex: totalSheets,
          newSheetName:     nomOnglet.substring(0, 50),
        }}]},
      });
      const newTitle   = dupRes.data.replies[0].duplicateSheet.properties.title;
      const newSheetId = dupRes.data.replies[0].duplicateSheet.properties.sheetId;

      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: {
          valueInputOption: 'USER_ENTERED',
          data: [
            { range: `${newTitle}!B2`,  values: [[nomSte]]           },
            { range: `${newTitle}!B5`,  values: [[profil[2] || '']]  },
            { range: `${newTitle}!B6`,  values: [[profil[3] || '']]  },
            { range: `${newTitle}!B7`,  values: [[profil[4] || '']]  },
            { range: `${newTitle}!D5`,  values: [[profil[5] || '']]  },
            { range: `${newTitle}!E11`, values: [[numFacture]]        },
            { range: `${newTitle}!E12`, values: [[dateFacture]]       },
            { range: `${newTitle}!C19`, values: [[qte1]]             },
            { range: `${newTitle}!D19`, values: [[tarif1]]           },
            { range: `${newTitle}!C20`, values: [[qte2]]             },
            { range: `${newTitle}!D20`, values: [[tarif2 || '']]     },
            { range: `${newTitle}!B21`, values: [[bonusLabel]]       },
            { range: `${newTitle}!E21`, values: [[bonusVal || '']]   },
            { range: `${newTitle}!B25`, values: [[profil[6] || '']]  },
            { range: `${newTitle}!B26`, values: [[profil[7] || '']]  },
            { range: `${newTitle}!B27`, values: [[profil[8] || '']]  },
          ],
        },
      });

      const token   = (await auth.getAccessToken()).token;
      const pdfUrl  = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=pdf&gid=${newSheetId}&portrait=true&fitw=true&size=A4`;
      const fetch   = (...args) => import('node-fetch').then(m => m.default(...args));
      const pdfResp = await fetch(pdfUrl, { headers: { Authorization: `Bearer ${token}` } });
      const pdfBuf  = Buffer.from(await pdfResp.arrayBuffer());

      await drive.files.create({
        requestBody: {
          name:    `${numFacture}_${nomSte.replace(/ /g,'-')}.pdf`,
          parents: [dossierMoisId],
        },
        media: {
          mimeType: 'application/pdf',
          body:     Readable.from(pdfBuf),
        },
        fields: 'id',
      });

      resultats.push(`✅ **${nomSdr}** — ${venu} RDV — Facture \`${numFacture}\` générée`);

    } catch (err) {
      console.error(`Erreur ${nomSdr}:`, err.message);
      resultats.push(`❌ **${nomSdr}** — Erreur: ${err.message}`);
    }
  }

  return { resultats, nomDossier, dossierMoisId };
}

module.exports = { genererFacturesAuto };
