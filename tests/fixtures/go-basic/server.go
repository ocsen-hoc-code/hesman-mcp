package server

import "fmt"

// Server is an HTTP server with configurable port and name.
type Server struct {
	port int
	name string
}

// NewServer creates a new Server instance.
func NewServer(port int, name string) *Server {
	return &Server{port: port, name: name}
}

// Start begins listening and returns a status message.
func (s *Server) Start() string {
	return fmt.Sprintf("Server %s started on port %d", s.name, s.port)
}

// Stop shuts down the server.
func (s *Server) Stop() {
	fmt.Println("Server stopped")
}
