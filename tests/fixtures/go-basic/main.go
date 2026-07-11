package main

import "fmt"

const VERSION = "1.0.0"

var count = 0

func add(a, b int) int {
	return a + b
}

func main() {
	result := add(1, 2)
	fmt.Println(result)
}
