export default async function handler(req, res) {
    // query: The search term (e.g., "Elvish" or "Khesari")
    // type: 'all', 'artist', or 'album' (Default is 'all')
    const { query, type = 'all' } = req.query;

    if (!query) {
        return res.status(400).json({ error: "Please provide ?query=YourSearchTerm" });
    }

    try {
        // 1. Construct the URL based on type
        let targetUrl = `https://open.spotify.com/search/${encodeURIComponent(query)}`;
        if (type === 'artist') targetUrl += '/artists';
        if (type === 'album') targetUrl += '/albums';

        // 2. Fetch Jina Text
        const jinaUrl = `https://r.jina.ai/${targetUrl}`;
        const jinaResponse = await fetch(jinaUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const text = await jinaResponse.text();

        // 3. Parse based on Type
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
            // Global Search (Split text into sections to avoid mixing)
            // We split by headings to ensure we search in the right places
            const songsSection = text.split(/Songs\n-+/)[1]?.split(/Featuring|Artists|Albums|Playlists/)[0] || "";
            const artistSection = text.split(/Artists\n-+/)[1]?.split(/Albums|Playlists|Podcasts/)[0] || "";
            const albumSection = text.split(/Albums\n-+/)[1]?.split(/Playlists|Podcasts|Profiles/)[0] || "";

            return res.status(200).json({
                status: "success",
                type: "global_search",
                songs: parseSongs(songsSection),
                artists: parseArtists(artistSection),
                albums: parseAlbums(albumSection)
            });
        }

    } catch (error) {
        return res.status(500).json({ error: "Server Error", details: error.message });
    }
}

// --- PARSERS ---

// 1. Parse Songs
function parseSongs(text) {
    // Pattern: Image -> Title -> Link -> Artists (on next line)
    // Jina Format: ![Image](url) \n [Title](url) \n Artist Name, Artist Name
    const regex = /!\[Image \d+\]\((https:\/\/i\.scdn\.co\/image\/[^)]+)\)\s*\n\s*\[([^\]]+)\]\((https:\/\/open\.spotify\.com\/track\/[^)]+)\)\s*\n\s*(.*)/g;
    
    const results = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
        // Clean up artist names (remove [ ] and (link))
        const rawArtists = match[4];
        const cleanArtists = rawArtists.replace(/\[|\]/g, '').replace(/\(https:\/\/[^)]+\)/g, '').trim();

        results.push({
            title: match[2],
            banner: match[1],
            artist_names: cleanArtists,
            track_link: match[3]
        });
    }
    return results;
}

// 2. Parse Artists
function parseArtists(text) {
    // Pattern: Image -> Name -> Link -> "Artist"
    const regex = /!\[Image \d+\]\((https:\/\/i\.scdn\.co\/image\/[^)]+)\)\s*\n\s*\[([^\]]+)\]\((https:\/\/open\.spotify\.com\/artist\/[^)]+)\)\s*\n\s*Artist/g;

    const results = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
        results.push({
            name: match[2],
            image: match[1],
            artist_link: match[3]
        });
    }
    return results;
}

// 3. Parse Albums
function parseAlbums(text) {
    // Pattern: Image -> Title -> Link -> Year • Artist
    const regex = /!\[Image \d+\]\((https:\/\/i\.scdn\.co\/image\/[^)]+)\)\s*\n\s*\[([^\]]+)\]\((https:\/\/open\.spotify\.com\/album\/[^)]+)\)\s*\n\s*(\d{4}) • (.*)/g;

    const results = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
        results.push({
            title: match[2],
            banner: match[1],
            year: match[4],
            description: match[5].replace(/\[|\]/g, '').replace(/\(https:\/\/[^)]+\)/g, '').trim(), // Clean artist names
            album_link: match[3]
        });
    }
    return results;
}
