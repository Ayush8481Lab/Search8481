export default async function handler(req, res) {
    const { query, type = 'all' } = req.query;

    if (!query) {
        return res.status(400).json({ error: "Please provide ?query=YourSearchTerm" });
    }

    try {
        let targetUrl = `https://open.spotify.com/search/${encodeURIComponent(query)}`;
        
        // Optimize: Only fetch the specific tab if requested
        if (type === 'artist') targetUrl += '/artists';
        if (type === 'album') targetUrl += '/albums';

        // Fetch Data (Auto-Retry)
        const text = await fetchWithRetry(`https://r.jina.ai/${targetUrl}`);

        // --- PARSING LOGIC ---
        
        if (type === 'artist') {
            // Parse ONLY Artists from the Artist Tab
            return res.status(200).json({
                status: "success",
                type: "artist_search",
                results: parseArtists(text)
            });
        } 
        else if (type === 'album') {
            // Parse ONLY Albums from the Album Tab
            return res.status(200).json({
                status: "success",
                type: "album_search",
                results: parseAlbums(text)
            });
        } 
        else {
            // GLOBAL SEARCH (All from ONE request)
            return res.status(200).json({
                status: "success",
                type: "global_search",
                songs: parseSongs(text),
                artists: parseArtists(text),
                albums: parseAlbums(text)
            });
        }

    } catch (error) {
        return res.status(500).json({ error: "Server Error", details: error.message });
    }
}

// --- HELPER: AUTO RETRY ---
async function fetchWithRetry(url, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            if (!res.ok) throw new Error(`Status ${res.status}`);
            const text = await res.text();
            if (text.length > 100) return text;
        } catch (e) {
            if (i === retries - 1) throw e;
            await new Promise(r => setTimeout(r, 800));
        }
    }
    return "";
}

// --- HELPER: CLEAN TEXT ---
function cleanText(str) {
    if (!str) return "";
    return str
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1') // Remove markdown links
        .replace(/\[|\]/g, '') // Remove brackets
        .replace(/"/g, '') // Remove quotes
        .trim();
}

// --- PARSERS ---

function parseSongs(text) {
    // Regex matches:
    // 1. Image
    // 2. Title
    // 3. CLEAN URL (Stops before space or quote)
    // 4. Artist Line (Next line)
    const regex = /!\[Image \d+\]\((https:\/\/i\.scdn\.co\/image\/[^)]+)\)\s*\n\s*\[([^\]]+)\]\((https:\/\/open\.spotify\.com\/track\/[a-zA-Z0-9]+)[^)]*\)\s*\n\s*([^\n]+)/g;
    
    const results = [];
    const seen = new Set();
    let match;

    while ((match = regex.exec(text)) !== null) {
        const id = match[3];
        if (seen.has(id)) continue;
        seen.add(id);

        results.push({
            title: match[2].trim(),
            banner: match[1],
            artist_names: cleanText(match[4]), // Removes links from artist names
            track_link: match[3] // Clean URL
        });
    }
    return results;
}

function parseArtists(text) {
    // Regex matches:
    // 1. Image
    // 2. Name
    // 3. CLEAN URL (Stops before space or quote)
    // 4. "Artist" literal (to ensure it's an artist)
    const regex = /!\[Image \d+\]\((https:\/\/i\.scdn\.co\/image\/[^)]+)\)\s*\n\s*\[([^\]]+)\]\((https:\/\/open\.spotify\.com\/artist\/[a-zA-Z0-9]+)[^)]*\)\s*\n\s*Artist/g;

    const results = [];
    const seen = new Set();
    let match;

    while ((match = regex.exec(text)) !== null) {
        const id = match[3];
        if (seen.has(id)) continue;
        seen.add(id);

        results.push({
            name: match[2].trim(),
            image: match[1],
            artist_link: match[3] // Clean URL
        });
    }
    return results;
}

function parseAlbums(text) {
    // Regex matches:
    // 1. Image
    // 2. Title
    // 3. CLEAN URL
    // 4. Description line (Year • Artist)
    const regex = /!\[Image \d+\]\((https:\/\/i\.scdn\.co\/image\/[^)]+)\)\s*\n\s*\[([^\]]+)\]\((https:\/\/open\.spotify\.com\/album\/[a-zA-Z0-9]+)[^)]*\)\s*\n\s*([^\n]+)/g;

    const results = [];
    const seen = new Set();
    let match;

    while ((match = regex.exec(text)) !== null) {
        const id = match[3];
        if (seen.has(id)) continue;
        seen.add(id);

        const rawDesc = match[4].trim();
        
        // Filter out Playlists masquerading as albums
        if (rawDesc.includes("Playlist") || rawDesc.includes("Spotify")) continue;

        // Extract Year (first 4 digits)
        const yearMatch = rawDesc.match(/\d{4}/);
        const year = yearMatch ? yearMatch[0] : "Unknown";

        results.push({
            title: match[2].trim(),
            banner: match[1],
            year: year,
            description: cleanText(rawDesc), // Full description (2024 • Artist)
            album_link: match[3] // Clean URL
        });
    }
    return results;
}
