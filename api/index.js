export default async function handler(req, res) {
    const { query, type = 'all' } = req.query;

    if (!query) {
        return res.status(400).json({ error: "Please provide ?query=YourSearchTerm" });
    }

    try {
        // 1. Construct URL based on type
        // We use the specific tabs to get cleaner data when possible
        let targetUrl = `https://open.spotify.com/search/${encodeURIComponent(query)}`;
        if (type === 'artist') targetUrl += '/artists';
        if (type === 'album') targetUrl += '/albums';

        // 2. Fetch Jina Text (Auto-Retry included)
        const text = await fetchWithRetry(`https://r.jina.ai/${targetUrl}`);

        // 3. Parse Based on Type
        if (type === 'artist') {
            return res.status(200).json({
                status: "success",
                type: "artist",
                results: parseArtists(text)
            });
        } 
        else if (type === 'album') {
            return res.status(200).json({
                status: "success",
                type: "album",
                results: parseAlbums(text)
            });
        } 
        else {
            // GLOBAL SEARCH (All Categories)
            return res.status(200).json({
                status: "success",
                type: "global",
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
            await new Promise(r => setTimeout(r, 800)); // Wait before retry
        }
    }
}

// --- HELPER: CLEAN MARKDOWN ---
function cleanMarkdownLinks(str) {
    if (!str) return "";
    // Replaces "[Name](Link)" with "Name"
    // Replaces "[Name]" with "Name"
    return str
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1') // Remove link, keep text
        .replace(/\[([^\]]+)\]/g, '$1') // Remove brackets
        .trim();
}

// --- PARSERS ---

function parseSongs(text) {
    // Looks for: Image -> Title(TrackLink) -> (Optional Newline) -> Artist Line
    // The artist line often contains commas: "Artist 1, Artist 2"
    const regex = /!\[Image \d+\]\((https:\/\/i\.scdn\.co\/image\/[^)]+)\)\s*\n\s*\[([^\]]+)\]\((https:\/\/open\.spotify\.com\/track\/[^)]+)\)\s*\n?([^\n]+)/g;
    
    const results = [];
    const seen = new Set();
    let match;

    while ((match = regex.exec(text)) !== null) {
        const id = match[3];
        if (seen.has(id)) continue;
        seen.add(id);

        // Group 1: Image
        // Group 2: Title
        // Group 3: Link
        // Group 4: Raw Artist Line (e.g. "[Artist](url), [Artist](url)")

        results.push({
            title: match[2].trim(),
            image: match[1],
            artist: cleanMarkdownLinks(match[4]), // Clean the artist line
            url: match[3]
        });
    }
    return results;
}

function parseArtists(text) {
    // Looks for: Image -> Name(ArtistLink) -> "Artist"
    // "Artist" literal helps filter out songs/albums that might look similar
    const regex = /!\[Image \d+\]\((https:\/\/i\.scdn\.co\/image\/[^)]+)\)\s*\n\s*\[([^\]]+)\]\((https:\/\/open\.spotify\.com\/artist\/[^)]+)\)\s*\n\s*Artist/g;

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
            url: match[3]
        });
    }
    return results;
}

function parseAlbums(text) {
    // Looks for: Image -> Title(AlbumLink) -> Year • Artist
    // The description usually starts with Year (4 digits)
    const regex = /!\[Image \d+\]\((https:\/\/i\.scdn\.co\/image\/[^)]+)\)\s*\n\s*\[([^\]]+)\]\((https:\/\/open\.spotify\.com\/album\/[^)]+)\)\s*\n\s*(\d{4}[^\n]*)/g;

    const results = [];
    const seen = new Set();
    let match;

    while ((match = regex.exec(text)) !== null) {
        const id = match[3];
        if (seen.has(id)) continue;
        seen.add(id);

        const rawDesc = match[4]; // e.g. "2024 • Artist Name"
        
        // Split Year and Artist if possible
        let year = "Unknown";
        let artist = "";
        
        if (rawDesc.includes('•')) {
            const parts = rawDesc.split('•');
            year = parts[0].trim();
            artist = cleanMarkdownLinks(parts.slice(1).join('•'));
        } else {
            year = rawDesc.substring(0, 4); // Guess first 4 chars are year
            artist = cleanMarkdownLinks(rawDesc.substring(4));
        }

        results.push({
            title: match[2].trim(),
            image: match[1],
            year: year,
            artist: artist,
            url: match[3]
        });
    }
    return results;
                }
