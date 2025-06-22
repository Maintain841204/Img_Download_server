const { PDFDocument } = require('pdf-lib');

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

        // Bilder sequenziell verarbeiten für bessere Reihenfolge
        for (let i = 0; i < urls.length; i++) {
            const url = urls[i];
            try {
                console.log(`Downloading image ${i + 1}/${urls.length}...`);
                
                const response = await fetch(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.9',
                        'Cache-Control': 'no-cache',
                        'Pragma': 'no-cache',
                        'Referer': new URL(url).origin
                    }
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const imageBuffer = await response.arrayBuffer();
                
                // Bild-Typ erkennen und einbetten
                let image;
                const contentType = response.headers.get('content-type') || '';
                
                try {
                    // Zuerst versuchen als JPEG (funktioniert für die meisten Formate)
                    image = await pdfDoc.embedJpg(imageBuffer);
                } catch (jpegError) {
                    console.log(`JPEG embed failed for image ${i + 1}, trying PNG...`);
                    try {
                        // Falls JPEG fehlschlägt, als PNG versuchen
                        image = await pdfDoc.embedPng(imageBuffer);
                    } catch (pngError) {
                        console.error(`Both JPEG and PNG embed failed for image ${i + 1}`);
                        throw new Error('Unsupported image format (probably WebP)');
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
            } catch (error) {
                console.error(`Failed to process image ${i + 1}: ${error.message}`);
                failed++;
                
                // Leere Seite mit Fehlermeldung hinzufügen
                const page = pdfDoc.addPage([595, 842]); // A4 size
                page.drawText(`Bild ${i + 1} konnte nicht geladen werden`, {
                    x: 50,
                    y: 400,
                    size: 20,
                });
            }
        }

        if (successful === 0) {
            return res.status(500).json({ 
                error: 'Keine Bilder konnten verarbeitet werden',
                details: `${failed} von ${urls.length} fehlgeschlagen`
            });
        }

        // PDF generieren
        const pdfBytes = await pdfDoc.save({
            useObjectStreams: false // Bessere Kompatibilität
        });

        // Response Headers für PDF
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="manga_${successful}_pages.pdf"`);
        res.setHeader('X-Images-Successful', successful);
        res.setHeader('X-Images-Failed', failed);
        
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

// Vercel Config für größere Payloads
export const config = {
    api: {
        bodyParser: {
            sizeLimit: '50mb'
        },
        responseLimit: '50mb'
    }
};
