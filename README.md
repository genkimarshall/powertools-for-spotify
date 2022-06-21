# Powertools for Spotify

This is the code repository for [Powertools for Spotify](https://genkimarshall.github.io/powertools-for-spotify/).

It is a motley collection of tools to examine and edit your Spotify collection.

## Testing your changes

The hardcoded `OAUTH_CLIENT_ID` in `index.html` is my own Spotify API (public) key. I have it configured so that the only allowed `redirect_uri` is the hosted instance linked above. Thus, to test your changes, you'll want to [create your own Client ID](https://developer.spotify.com/documentation/general/guides/authorization/app-settings/), enable your own Redirect URI (for example, `http://localhost:8000/`), then update `OAUTH_CLIENT_ID`.
