// js/admin/csv.js

export function parseVanillaCSV(text) {
    const result = [];
    let row = [];
    let inQuotes = false;
    let value = '';
    
    for (let i = 0; i < text.length; i++) {
        let char = text[i];
        
        if (char === '"' && text[i+1] === '"') { 
            value += '"'; // Handle escaped quotes inside names
            i++; 
        } else if (char === '"') { 
            inQuotes = !inQuotes; 
        } else if (char === ',' && !inQuotes) { 
            row.push(value.trim()); 
            value = ''; 
        } else if (char === '\n' && !inQuotes) {
            row.push(value.trim());
            if (row.join('').trim() !== '') result.push(row); 
            row = []; 
            value = '';
        } else if (char !== '\r') { 
            value += char; 
        }
    }
    
    if (value || row.length > 0) { 
        row.push(value.trim()); 
        result.push(row); 
    }
    
    return result;
}