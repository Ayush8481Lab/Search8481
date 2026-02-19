export default async function handler(req, res) {
    const { link } = req.query;

    if (!link) {
        return res.status(400).json({ error: "Please provide a link using ?link=..." });
    }

    // OPTIMIZATION 1: Enable Vercel Edge Caching
    // s-maxage=86400: Cache on Vercel's servers for 24 hours (Super fast for repeat visits)
    // stale-while-revalidate=43200: Serve old data instantly while updating in the background
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=43200');

    try {
        // OPTIMIZATION 2: Parallel Fetching if you need external data (not needed here yet, but good practice)
        
        // OPTIMIZATION 3: Jina Headers for Speed
        const jinaUrl = `https://r.jina.ai/${link}`;
        const jinaResponse = await fetch(jinaUrl, { 
            headers: { 
                'User-Agent': 'Mozilla/5.0',
                'X-No-Cache': 'false',           // Allow Jina to use its own cache
                'X-With-Generated-Alt': 'false', // Disable AI image captioning (Saves time)
                'X-Respond-With': 'markdown'     // Force simple markdown (Less data to transfer)
            } 
        });
        
        if (!jinaResponse.ok) throw new Error("Jina Scrape Failed");
        const text = await jinaResponse.text();

        // 2. Determine Mode & Parse
        if (link.includes("/album/")) {
            return parseAlbum(text, link, res);
        } else if (link.includes("/artist/")) {
            return parseArtist(text, link, res);
        } else {
            return res.status(400).json({ error: "Link must be a Spotify Album or Artist URL" });
        }

    } catch (error) {
        return res.status(500).json({ error: "Server Error", details: error.message });
    }
}

// --- LOGIC 1: ALBUM PARSER (Optimized Regex) ---
function parseAlbum(text, sourceLink, res) {
    // Extract Meta
    const titleMatch = text.match(/Title: (.*?)(\n|$)/);
    const rawTitle = titleMatch ? titleMatch[1] : "Unknown";
    const cleanTitle = rawTitle.split(' - Album')[0].trim();
    
    const coverMatch = text.match(/!\[Image \d+\]\((https:\/\/i\.scdn\.co\/image\/[^)]+)\)/);
    const albumCover = coverMatch ? coverMatch[1] : "";

    const yearMatch = text.match(/•(\d{4})•/);
    const statsMatch = text.match(/(\d+ songs, .*?sec)/);
    
    // OPTIMIZATION 4: Single Pass Regex Loop
    // Instead of splitting text multiple times, we run one efficient loop
    const trackPattern = /^\d+\s*\n\s*\[([^\]]+)\]\((https:\/\/open\.spotify\.com\/track\/[^)]+)\)(.*)/gm;
    
    const tracks = [];
    let match;

    while ((match = trackPattern.exec(text)) !== null) {
        const rawArtists = match[3];
        // Fast artist extraction
        const artistNames = [...rawArtists.matchAll(/\[([^\]]+)\]/g)].map(m => m[1]).join(", ");

        tracks.push({
            title: match[1],
            artist_names: artistNames,
            spotify_url: match[2],
            track_image: albumCover
        });
    }

    // Related Albums
    const relatedAlbums = [];
    // We only scan the bottom part of the text for related items to save processing
    const moreBySection = text.split(/More by .*/)[1] || "";
    const relatedPattern = /!\[Image \d+\]\((https:\/\/i\.scdn\.co\/image\/[^)]+)\)\s*\n\s*\[([^\]]+)\]\((https:\/\/open\.spotify\.com\/album\/[^)]+)\)\s*\n\s*(\d{4})/g;
    
    let relMatch;
    while ((relMatch = relatedPattern.exec(moreBySection)) !== null) {
        relatedAlbums.push({
            name: relMatch[2],
            image: relMatch[1],
            year: relMatch[4],
            url: relMatch[3]
        });
    }

    return res.status(200).json({
        type: "album",
        metadata: {
            name: cleanTitle,
            year: yearMatch ? yearMatch[1] : "Unknown",
            stats: statsMatch ? statsMatch[1] : "",
            cover_image: albumCover,
            spotify_link: sourceLink
        },
        tracks: tracks,
        related_albums: relatedAlbums
    });
}

// --- LOGIC 2: ARTIST PARSER (Optimized) ---
function parseArtist(text, sourceLink, res) {
    const nameMatch = text.match(/Title: (.*?) \| Spotify/);
    const listenerMatch = text.match(/([\d,]+) monthly listeners/);
    
    // Efficient Image Finding
    const mainImgMatch = text.match(/!\[Image \d+\]\((https:\/\/i\.scdn\.co\/image\/[^)]+)\)\s*\n\s*.*?\n\s*=/);
    const fallbackImg = text.match(/!\[Image \d+\]\((https:\/\/i\.scdn\.co\/image\/[^)]+)\)/);
    
    // Top Songs
    const popularSection = text.split("Popular")[1]?.split("Discography")[0] || "";
    const topSongPattern = /!\[Image \d+\]\((https:\/\/i\.scdn\.co\/image\/[^)]+)\)\s*\n\s*\[([^\]]+)\]\((https:\/\/open\.spotify\.com\/track\/[^)]+)\)/g;
    
    const topSongs = [];
    let topMatch;
    while ((topMatch = topSongPattern.exec(popularSection)) !== null) {
        topSongs.push({
            title: topMatch[2],
            image: topMatch[1],
            url: topMatch[3]
        });
    }

    // Discography (Albums/Singles)
    let discographySection = text.split("Discography")[1] || "";
    discographySection = discographySection.split(/Appears On|Fans also like|Artist Playlists|Discovered on/)[0];

    const releasePattern = /!\[Image \d+\]\((https:\/\/i\.scdn\.co\/image\/[^)]+)\)\s*\n\s*\[([^\]]+)\]\((https:\/\/open\.spotify\.com\/album\/[^)]+)\)\s*\n\s*(\d{4} • [A-Za-z]+|Latest Release • [A-Za-z]+)/g;

    const albums_and_singles = [];
    let discMatch;
    while ((discMatch = releasePattern.exec(discographySection)) !== null) {
        albums_and_singles.push({
            name: discMatch[2],
            image: discMatch[1],
            url: discMatch[3],
            description: discMatch[4]
        });
    }

    return res.status(200).json({
        type: "artist",
        metadata: {
            name: nameMatch ? nameMatch[1] : "Unknown",
            monthly_listeners: listenerMatch ? listenerMatch[1] : "Unknown",
            image: mainImgMatch ? mainImgMatch[1] : (fallbackImg ? fallbackImg[1] : ""),
            profile_url: sourceLink
        },
        top_songs: topSongs,
        albums_and_singles: albums_and_singles
    });
        }
