package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"runtime"
	"time"
)

type SystemStatus struct {
	App         string    `json:"app"`
	Version     string    `json:"version"`
	Status      string    `json:"status"`
	OS          string    `json:"os"`
	Arch        string    `json:"arch"`
	NumCPU      int       `json:"num_cpu"`
	Timestamp   time.Time `json:"timestamp"`
	UptimeSec   int64     `json:"uptime_sec"`
}

var startTime = time.Now()

func statusHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	status := SystemStatus{
		App:       "CilamAI-ITSM-Go",
		Version:   "0.1.0.1",
		Status:    "HEALTHY",
		OS:        runtime.GOOS,
		Arch:      runtime.GOARCH,
		NumCPU:    runtime.NumCPU(),
		Timestamp: time.Now().UTC(),
		UptimeSec: int64(time.Since(startTime).Seconds()),
	}

	if err := json.NewEncoder(w).Encode(status); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"OK","code":200}`))
}

func main() {
	port := os.Getenv("ITSM_PORT")
	if port == "" {
		port = "9876"
	}

	http.HandleFunc("/status", statusHandler)
	http.HandleFunc("/health", healthHandler)

	fmt.Println("==================================================")
	fmt.Printf(" CilamAI ITSM Go Daemon running on port :%s\n", port)
	fmt.Println(" Endpoints:")
	fmt.Printf("  - http://localhost:%s/status\n", port)
	fmt.Printf("  - http://localhost:%s/health\n", port)
	fmt.Println("==================================================")

	addr := fmt.Sprintf("127.0.0.1:%s", port)
	if err := http.ListenAndServe(addr, nil); err != nil {
		log.Fatalf("Server failed to start: %v\n", err)
	}
}
