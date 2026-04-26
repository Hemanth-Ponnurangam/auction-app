/**
 * csv.js
 * Handles parsing uploaded CSV files and saving them to the Firebase Preset Databases.
 */

import { db } from '../shared/firebase.js';
import { showAlert } from '../shared/dom.js';

const CRORE = 10_000_000;

/**
 * Parses the 12-column CSV file into an array of player objects.
 */
export function parseCSV(text) {
    let lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    let raw = lines[0].split(',');
    let hdrs = raw.map(h => h.trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
    let result = [];
    
    for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        // Handle commas inside quotes correctly
        let cols = lines[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
        let obj = { status: 'available' };
        
        for (let j = 0; j < hdrs.length; j++) {
            let v = (cols[j] || '').replace(/['"]+/g, '').trim();
            let h = hdrs[j];
            
            if (h === 'baseprice') {
                let num = Number(v) || 0;
                obj.base_price = (num > 0 && num <= 100) ? num * CRORE : num;
            } else if (['runs','average','avg','sr','strikerate','wickets','economy','econ','bowlingsr'].includes(h)) {
                let key = h;
                if(h === 'avg') key = 'average';
                if(h === 'strikerate' || h === 'sr') key = 'bat_sr';
                if(h === 'econ') key = 'economy';
                if(h === 'bowlingsr') key = 'bowl_sr';
                obj[key] = v || '-';
            } else if (['name','set','role','franchise','nationality'].includes(h)) {
                obj[h] = v;
            }
        }
        result.push(obj);
    }
    return result;
}

/**
 * Uploads a parsed CSV to the global preset databases node.
 */
export function uploadPresetDB(dbName, file) {
    if (!dbName || !file) {
        showAlert('Missing Info', 'Provide a name and select a CSV file.');
        return;
    }

    let reader = new FileReader();
    reader.onload = e => {
        let pool = parseCSV(e.target.result);
        if (pool.length && pool[0].name !== undefined) {
            db.ref('preset_databases/' + dbName.toLowerCase().replace(/[^a-z0-9]/g, '')).set(pool)
                .then(() => {
                    showAlert('Success', `Database '${dbName}' uploaded with ${pool.length} players!`);
                    document.getElementById('dbNameInput').value = '';
                    document.getElementById('csvFileInput').value = '';
                })
                .catch(err => showAlert('Upload Error', err.message));
        } else {
            showAlert('CSV Error', 'Could not parse the file. Ensure you use the exact 12 columns.');
        }
    };
    reader.readAsText(file);
}

// Attach to window for HTML inline access
window.uploadPresetDB = uploadPresetDB;