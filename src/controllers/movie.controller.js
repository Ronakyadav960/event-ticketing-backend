const movieRecommendationService = require('../services/movie-recommendation.service');

function readPositiveInt(value, fallback, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

exports.listMovies = async (req, res) => {
  try {
    const query = String(req.query.q || req.query.query || '').trim();
    const page = readPositiveInt(req.query.page, 1, 5000);
    const limit = readPositiveInt(req.query.limit, 12, 40);
    const payload = await movieRecommendationService.listMovies(query, page, limit);
    return res.json(payload);
  } catch (error) {
    console.error('MOVIE LIST ERROR', error);
    return res.status(500).json({ message: error.message || 'Movie list failed.' });
  }
};

exports.searchMovies = async (req, res) => {
  try {
    const query = String(req.query.q || req.query.query || '').trim();

    if (!query) {
      return res.status(400).json({ message: 'Search query is required.' });
    }

    const limit = readPositiveInt(req.query.limit, 8, 20);
    const payload = await movieRecommendationService.searchMovies(query, limit);
    return res.json(payload);
  } catch (error) {
    console.error('MOVIE SEARCH ERROR', error);
    return res.status(500).json({ message: error.message || 'Movie search failed.' });
  }
};

exports.getMovieById = async (req, res) => {
  try {
    const movieId = String(req.params.movieId || '').trim();
    if (!movieId) {
      return res.status(400).json({ message: 'Movie id is required.' });
    }

    const payload = await movieRecommendationService.getMovieById(movieId);
    return res.json(payload);
  } catch (error) {
    console.error('MOVIE DETAIL ERROR', error);
    const status = /not found/i.test(error.message || '') ? 404 : 500;
    return res.status(status).json({ message: error.message || 'Movie detail failed.' });
  }
};

exports.getRecommendations = async (req, res) => {
  try {
    const title = String(req.query.title || '').trim();

    if (!title) {
      return res.status(400).json({ message: 'Movie title is required.' });
    }

    const limit = readPositiveInt(req.query.limit, 6, 20);
    const payload = await movieRecommendationService.getRecommendations(title, limit);
    return res.json(payload);
  } catch (error) {
    console.error('MOVIE RECOMMENDATION ERROR', error);
    return res.status(500).json({ message: error.message || 'Movie recommendation failed.' });
  }
};
