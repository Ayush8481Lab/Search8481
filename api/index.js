export default async function handler(req, res) {
    // query: search term
    // type: 'all', 'artist', 'album'
    const { query, type = 'all' } = req.query;

    if (!query) {
        return res.status(400).json({ error: "Please provide ?query=YourSearchTerm" });
    }

    try {
        // 1. Construct Spotify URL
        let targetUrl = `https://open.spotify.com/search/${encodeURIComponent(query)}`;
        if (type === 'artist') targetUrl += '/artists';
        if (type === 'album') targetUrl += '/albums';

        // 2. Fetch Jina Text (With Auto-Retry 3 times)
        const text = await fetchWithRetry(`https://r.jina.ai/${targetUrl}`);

        // 3. Parse Data based on Type
        if (type === 'artist') {
            return res.status(200).json({
                status: "success",
                type: "artist_search",
                results: parseArtists(text)
            });
        } 
        else if (type === 'album') {
            return res.status(200).json({
                status: "success",
                type: "album_search",
                results: parseAlbums(text)
            });
        } 
        else {
            // GLOBAL SEARCH
            // We parse everything from the text independently
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
            const res = await fetch(url, { 
                headers: { 
                    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.121 Mobile Safari/537.36' 
                } 
            });
            if (!res.ok) throw new Error(`Status ${res.status}`);
            const text = await res.text();
            if (text && text.length > 100) return text; // Ensure we got actual content
        } catch (e) {
            if (i === retries - 1) throw e;
            await new Promise(r => setTimeout(r, 1000)); // Wait 1s before retry
        }
    }
}

// --- PARSERS ---

function parseSongs(text) {
    // Regex looks for: Image -> Title -> /track/ Link -> Next Line (Artists)
    // Matches: ![Image](url) \n [Title](.../track/...) \n Artists...
    const regex = /!\[Image \d+\]\((https:\/\/i\.scdn\.co\/image\/[^)]+)\)\s*\n\s*\[([^\]]+)\]\((https:\/\/open\.spotify\.com\/track\/[^)]+)\)(.*)/g;
    
    const results = [];
    const seen = new Set();
    let match;
    
    while ((match = regex.exec(text)) !== null) {
        const id = match[3]; // Use URL as unique ID
        if (seen.has(id)) continue;
        seen.add(id);

        // Clean up artists line
        // It usually looks like: "[Artist](link), [Artist](link)" or just text
        let rawArtists = match[4].trim();
        // Remove links and brackets to get plain text
        const cleanArtists = rawArtists
            .replace(/\[([^\]]+)\]\(https:\/\/[^)]+\)/g, '$1') // Keep name, remove link
            .replace(/\[|\]/g, '') // Remove leftover brackets
            .trim();

        results.push({
            title: match[2],
            banner: match[1],
            artist_names: cleanArtists || "Unknown Artist",
            track_link: match[3]
        });
    }
    return results;
}

function parseArtists(text) {
    // Regex looks for: Image -> Name -> /artist/ Link
    const regex = /!\[Image \d+\]\((https:\/\/i\.scdn\.co\/image\/[^)]+)\)\s*\n\s*\[([^\]]+)\]\((https:\/\/open\.spotify\.com\/artist\/[^)]+)\)/g;

    const results = [];
    const seen = new Set();
    let match;

    while ((match = regex.exec(text)) !== null) {
        const id = match[3];
        if (seen.has(id)) continue;
        seen.add(id);

        results.push({
            name: match[2],
            image: match[1],
            artist_link: match[3]
        });
    }
    return results;
}

function parseAlbums(text) {
    // Regex looks for: Image -> Title -> /album/ Link -> Year
    // It captures the description line which usually starts with Year (e.g., 2025 • Artist)
    const regex = /!\[Image \d+\]\((https:\/\/i\.scdn\.co\/image\/[^)]+)\)\s*\n\s*\[([^\]]+)\]\((https:\/\/open\.spotify\.com\/album\/[^)]+)\)\s*\n\s*(\d{4})?([^\n]*)/g;

    const results = [];
    const seen = new Set();
    let match;

    while ((match = regex.exec(text)) !== null) {
        const id = match[3];
        if (seen.has(id)) continue;
        seen.add(id);

        // Clean up description (remove links from artist names in description)
        const rawDesc = match[5] || "";
        const cleanDesc = rawDesc.replace(/\[([^\]]+)\]\(https:\/\/[^)]+\)/g, '$1').trim();

        results.push({
            title: match[2],
            banner: match[1],
            year: match[4] || "Unknown",
            description: cleanDesc ? `${match[4] || ""} ${cleanDesc}` : (match[4] || ""),
            album_link: match[3]
        });
    }
    return results;
                }
