const { google } = require('googleapis');
const { getGoogleAuth } = require('./googleService');

const SPREADSHEET_ID  = process.env.SPREADSHEET_ID;
const STATS_SHEET     = 'STATS DATA';

const HICHAM_SDR = 'Hicham ELMOUSSAID';
const JIHANE_SDR = 'Jihane ENNACERIE';

const MONTH_NAMES = {
  1:'01-JANUARY', 2:'02-FEBRUARY', 3:'03-MARCH',    4:'04-APRIL',
  5:'05-MAY',     6:'06-JUNE',     7:'07-JULY',      8:'08-AUGUST',
  9:'09-SEPTEMBER',10:'10-OCTOBER',11:'11-NOVEMBER',12:'12-DECEMBER'
};

function nettoyerNom(str) {
  if (!str) return '';
  return str.replace(/[^a-zA-ZÀ-ÿ\s'-]/g, '').trim();
}

async function genererFacturesAuto() {
  const auth   = await getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const now         = new Date();
  const moisNum     = now.getMonth() === 0 ? 12 : now.getMonth();
  const annee       = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const anneeShort  = String(annee).slice(2);
  const dateFacture = `08/${String(moisNum).padStart(2,'0')}/${annee}`;
  const nomDossier  = `${MONTH_NAMES[moisNum]} ${annee}`;

  // ── Lire PROFILS ──────────────────────────────────────────────────────────
  const profilsRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'PROFILS!A2:L',
  });
  const profils = (profilsRes.data.values || []).filter(p => p[1]);
  console.log(`${profils.length} agents trouvés dans PROFILS`);
  profils.forEach(p => console.log(`Agent: "${p[1]}" | Société: "${p[2]}"`));

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
    const nomSdr  = profil[1].trim();
    const statRow = statsRows.find(r => r[0] && nettoyerNom(r[0]) === nomSdr);
    if (!statRow) continue;
    const venu = parseInt(statRow[5]) || 0;
    totalVenuEquipe += venu;
    if (nomSdr === HICHAM_SDR) venuHicham = venu;
  }
  const venuSansHicham = totalVenuEquipe - venuHicham;
  console.log(`Total VENU: ${totalVenuEquipe} | Hicham: ${venuHicham} | Sans Hicham: ${venuSansHicham}`);

  // ── Récupérer le sheetId du MODELE ────────────────────────────────────────
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const modeleSheet = spreadsheet.data.sheets.find(s => s.properties.title === 'MODELE');

  // ── Générer une facture par agent ─────────────────────────────────────────
  const resultats = [];

  for (const profil of profils) {
    const nomSdr  = profil[1].trim();
    const nomSte  = profil[2] || nomSdr;
    const statRow = statsRows.find(r => r[0] && nettoyerNom(r[0]) === nomSdr);

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
    const timestamp  = Date.now().toString().slice(-4);
    const nomOnglet  = `${numFacture}-${nomSte.substring(0,10).replace(/ /g,'-')}-${timestamp}`;

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
            { range: `${newTitle}!B5`,  values: [[profil[3] || '']]  },
            { range: `${newTitle}!B6`,  values: [[profil[4] || '']]  },
            { range: `${newTitle}!B7`,  values: [[profil[5] || '']]  },
            { range: `${newTitle}!D5`,  values: [[profil[6] || '']]  },
            { range: `${newTitle}!E11`, values: [[numFacture]]        },
            { range: `${newTitle}!E12`, values: [[dateFacture]]       },
            { range: `${newTitle}!C19`, values: [[qte1]]             },
            { range: `${newTitle}!D19`, values: [[tarif1]]           },
            { range: `${newTitle}!C20`, values: [[qte2]]             },
            { range: `${newTitle}!D20`, values: [[tarif2 || '']]     },
            { range: `${newTitle}!B21`, values: [[bonusLabel]]       },
            { range: `${newTitle}!E21`, values: [[bonusVal || '']]   },
            { range: `${newTitle}!B25`, values: [[profil[7] || '']]  },
            { range: `${newTitle}!B26`, values: [[profil[8] || '']]  },
            { range: `${newTitle}!B27`, values: [[profil[9] || '']]  },
          ],
        },
      });

      const lien = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit#gid=${newSheetId}`;
      resultats.push(`✅ **${nomSdr}** — ${venu} RDV — [Facture ${numFacture}](${lien})`);

    } catch (err) {
      console.error(`Erreur ${nomSdr}:`, err.message);
      resultats.push(`❌ **${nomSdr}** — Erreur: ${err.message}`);
    }
  }

  return { resultats, nomDossier };
}

module.exports = { genererFacturesAuto };
