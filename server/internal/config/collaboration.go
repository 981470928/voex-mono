package config

type Collaboration struct {
	Enabled                bool
	URL, SecretFile, WSURL string
}

func ReadCollaboration() Collaboration {
	return Collaboration{
		Enabled:    Env("VOEX_COLLAB_ENABLED", "false") == "true",
		URL:        Env("VOEX_COLLAB_URL", "http://127.0.0.1:8091"),
		SecretFile: Env("VOEX_COLLAB_SECRET_FILE", "/home/server/.secrets/collab-key"),
		WSURL:      Env("VOEX_COLLAB_WS_URL", "/api/collab/ws"),
	}
}
