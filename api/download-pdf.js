const { PDFDocument, rgb } = require('pdf-lib');

// CORS Middleware
const allowCors = fn => async (req, res) => {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );
    
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    
    return await fn(req, res);
}

// Helper: Bild-Typ aus Buffer erkennen
function detectImageType(buffer) {
    const arr = new Uint8Array(buffer);
    
    // Check PNG signature
    if (arr[0] === 0x89 && arr[1] === 0x50 && arr[2] === 0x4E && arr[3] === 0x47) {
        return 'png';
    }
    
    // Check JPEG signature
    if (arr[0] === 0xFF && arr[1] === 0xD8 && arr[2] === 0xFF) {
        return 'jpeg';
    }
    
    // Check WebP signature
    if (arr[8] === 0x57 && arr[9] === 0x45 && arr[10] === 0x42 && arr[11] === 0x50) {
        return 'webp';
    }
    
    return 'unknown';
}

// Main handler function
const handler = async (req, res) => {
    // Nur POST erlauben
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { urls } = req.body;
        
        if (!urls || !Array.isArray(urls)) {
            return res.status(400).json({ error: 'URLs array required' });
        }

        console.log(`Processing ${urls.length} images for PDF...`);
        
        // Neues PDF erstellen
        const pdfDoc = await PDFDocument.create();
        let successful = 0;
        let failed = 0;
        const skippedWebP = [];

        // Bilder sequenziell verarbeiten für bessere Reihenfolge
        for (let i = 0; i < urls.length; i++) {
            const url = urls[i];
            let retryCount = 0;
            const maxRetries = 2;
            
            while (retryCount <= maxRetries) {
                try {
                    console.log(`Downloading image ${i + 1}/${urls.length}... (Attempt ${retryCount + 1})`);
                    
                    const response = await fetch(url, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                            'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
                            'Accept-Language': 'en-US,en;q=0.9',
                            'Accept-Encoding': 'gzip, deflate, br',
                            'Cache-Control': 'no-cache',
                            'Pragma': 'no-cache',
                            'Referer': new URL(url).origin,
                            'Sec-Fetch-Dest': 'image',
                            'Sec-Fetch-Mode': 'no-cors',
                            'Sec-Fetch-Site': 'same-origin'
                        },
                        redirect: 'follow'
                    });

                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status} ${response.statusText}`);
                    }

                    const imageBuffer = await response.arrayBuffer();
                    const imageType = detectImageType(imageBuffer);
                    
                    console.log(`Image ${i + 1} type: ${imageType}`);
                    
                    // WebP überspringen mit Hinweis
                    if (imageType === 'webp') {
                        console.log(`Skipping WebP image ${i + 1}`);
                        skippedWebP.push(i + 1);
                        
                        const page = pdfDoc.addPage([595, 842]); // A4
                        page.drawText(`Bild ${i + 1}: WebP-Format wird nicht unterstützt`, {
                            x: 50,
                            y: 750,
                            size: 16,
                            color: rgb(0.7, 0.7, 0.7),
                        });
                        page.drawText(`Tipp: Verwende stattdessen die ZIP-Download Option`, {
                            x: 50,
                            y: 720,
                            size: 14,
                            color: rgb(0.5, 0.5, 0.5),
                        });
                        failed++;
                        break;
                    }
                    
                    let image;
                    
                    // Versuche das Bild einzubetten
                    if (imageType === 'png') {
                        try {
                            image = await pdfDoc.embedPng(imageBuffer);
                        } catch (e) {
                            console.log(`PNG embed failed, trying as JPEG...`);
                            image = await pdfDoc.embedJpg(imageBuffer);
                        }
                    } else {
                        try {
                            image = await pdfDoc.embedJpg(imageBuffer);
                        } catch (e) {
                            console.log(`JPEG embed failed, trying as PNG...`);
                            image = await pdfDoc.embedPng(imageBuffer);
                        }
                    }
                    
                    // Neue Seite mit Bildgröße erstellen
                    const page = pdfDoc.addPage([image.width, image.height]);
                    
                    // Bild auf die Seite zeichnen
                    page.drawImage(image, {
                        x: 0,
                        y: 0,
                        width: image.width,
                        height: image.height,
                    });

                    successful++;
                    console.log(`Successfully added image ${i + 1}`);
                    break; // Erfolgreich, keine weiteren Versuche nötig
                    
                } catch (error) {
                    console.error(`Attempt ${retryCount + 1} failed for image ${i + 1}: ${error.message}`);
                    
                    if (retryCount === maxRetries) {
                        // Letzter Versuch fehlgeschlagen
                        failed++;
                        
                        const page = pdfDoc.addPage([595, 842]); // A4
                        page.drawText(`Bild ${i + 1} konnte nicht geladen werden`, {
                            x: 50,
                            y: 750,
                            size: 20,
                            color: rgb(1, 0, 0),
                        });
                        
                        page.drawText(`Fehler: ${error.message}`, {
                            x: 50,
                            y: 700,
                            size: 12,
                            color: rgb(0, 0, 0),
                        });
                        
                        // Kurze URL anzeigen
                        const shortUrl = url.length > 80 ? url.substring(0, 77) + '...' : url;
                        page.drawText(`URL: ${shortUrl}`, {
                            x: 50,
                            y: 670,
                            size: 10,
                            color: rgb(0.5, 0.5, 0.5),
                        });
                    } else {
                        // Warte kurz vor dem nächsten Versuch
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        retryCount++;
                    }
                }
            }
        }

        if (successful === 0) {
            return res.status(500).json({ 
                error: 'Keine Bilder konnten verarbeitet werden',
                details: `${failed} von ${urls.length} fehlgeschlagen`,
                webpImages: skippedWebP.length
            });
        }

        // PDF generieren
        console.log('Generating PDF...');
        const pdfBytes = await pdfDoc.save({
            useObjectStreams: false // Bessere Kompatibilität
        });

        // Response Headers für PDF
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="manga_${successful}_pages.pdf"`);
        res.setHeader('X-Images-Successful', successful);
        res.setHeader('X-Images-Failed', failed);
        res.setHeader('X-WebP-Skipped', skippedWebP.length);
        
        console.log(`PDF created: ${successful} pages, ${failed} failed, ${skippedWebP.length} WebP skipped`);
        
        return res.status(200).send(Buffer.from(pdfBytes));

    } catch (error) {
        console.error('Server error:', error);
        return res.status(500).json({ 
            error: 'Server error', 
            message: error.message 
        });
    }
}

// Export mit CORS wrapper
module.exports = allowCors(handler);

// Vercel Config für größere Payloads und längere Timeouts
export const config = {
    api: {
        bodyParser: {
            sizeLimit: '50mb'
        },
        responseLimit: '50mb'
    },
    maxDuration: 30 // 30 Sekunden sollten reichen
};
