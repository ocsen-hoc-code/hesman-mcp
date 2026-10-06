package main

import "net/http"

// ParseQueryParams flattens the URL query of a request into a map.
func ParseQueryParams(r *http.Request) map[string]string {
	out := make(map[string]string)
	for key, values := range r.URL.Query() {
		if len(values) > 0 {
			out[key] = values[0]
		}
	}
	return out
}
