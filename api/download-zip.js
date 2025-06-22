const JSZip = require('jszip');

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

        console.log(`Processing ${urls.length} images...`);
        
        const zip = new JSZip();
        let successful = 0;
        let failed = 0;

        // Bilder parallel laden für bessere Performance
        const downloadPromises = urls.map(async (url, index) => {
            try {
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

                const buffer = await response.arrayBuffer();
                const filename = `image_${String(index + 1).padStart(3, '0')}.jpg`;
                zip.file(filename, buffer);
                successful++;
                return { success: true };
            } catch (error) {
                console.error(`Failed to download image ${index}: ${error.message}`);
                failed++;
                return { success: false, error: error.message };
            }
        });

        // Warte auf alle Downloads
        await Promise.all(downloadPromises);

        if (successful === 0) {
            return res.status(500).json({ 
                error: 'Keine Bilder konnten heruntergeladen werden',
                details: `${failed} von ${urls.length} fehlgeschlagen`
            });
        }

        // ZIP generieren
        const zipBuffer = await zip.generateAsync({ 
            type: 'nodebuffer',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 }
        });

        // Response Headers für ZIP
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="manga_${successful}_images.zip"`);
        res.setHeader('X-Images-Successful', successful);
        res.setHeader('X-Images-Failed', failed);
        
        return res.status(200).send(zipBuffer);

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
