package main

import (
	"fmt"
	"strings"
)

// GoFormatName trims surrounding whitespace from a name.
func GoFormatName(name string) string {
	return strings.TrimSpace(name)
}

// GoGreet builds a greeting for the given name.
func GoGreet(name string) string {
	return fmt.Sprintf("Hello, %s!", GoFormatName(name))
}
