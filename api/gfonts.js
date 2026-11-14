// Vercel serverless proxy for Google Fonts metadata (avoids CORS)
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const response = await fetch("https://fonts.google.com/metadata/fonts");
    // Never cache an upstream error for a day.
    if (!response.ok) throw new Error(`upstream ${response.status}`);
    const data = await response.json();
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400");
    res.status(200).json(data);
  } catch {
    res.status(502).json({ error: "Failed to fetch Google Fonts metadata" });
  }
}
