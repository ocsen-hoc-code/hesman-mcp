package types

// Shape defines geometry methods.
type Shape interface {
	Area() float64
}

// Circle represents a circle shape.
type Circle struct {
	Radius float64
}

// MyInt is a custom integer type.
type MyInt int

const Pi = 3.14

const Eps = 1e-10

var DefaultRadius = 1.0
