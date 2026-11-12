package config

import (
	"strconv"
	"time"
)

type History struct {
	Enabled          bool
	SnapshotInterval time.Duration
	MaxVersions      int64
}

func ReadHistory() History {
	interval := 5 * time.Minute
	if seconds, err := strconv.ParseInt(
		Env("VOEX_HISTORY_SNAPSHOT_INTERVAL", "300"),
		10,
		64,
	); err == nil &&
		seconds > 0 {
		interval = time.Duration(seconds) * time.Second
	}
	maxVersions := int64(500)
	if count, err := strconv.ParseInt(
		Env("VOEX_HISTORY_MAX_VERSIONS", "500"),
		10,
		64,
	); err == nil &&
		count > 0 {
		maxVersions = count
	}
	return History{
		Enabled:          Env("VOEX_HISTORY_ENABLED", "true") == "true",
		SnapshotInterval: interval,
		MaxVersions:      maxVersions,
	}
}
