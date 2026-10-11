// Package inventory is the Go fixture of the language conformance suite.
package inventory

import (
	"fmt"
	"strings"
)

// MaxItems is the largest count an item may have.
const MaxItems = 100

const minItems, defaultName = 0, "item"

// Status values of an item.
const (
	StatusActive  = "active"
	statusRetired = "retired"
)

var registry = map[string]*Item{}

var hits, misses int

// Item is one stock item.
type Item struct {
	Name  string
	Count int
}

// Stocker is anything that can be restocked.
type Stocker interface {
	Restock(amount int) int
}

type itemKey string

// NewItem creates an item with a normalized name.
func NewItem(name string) *Item {
	item := &Item{Name: normalize(name), Count: minItems}
	registry[string(itemKey(item.Name))] = item
	return item
}

// Restock adds stock to the item, capped at MaxItems.
func (i *Item) Restock(amount int) int {
	i.Count = clamp(i.Count + amount)
	return i.Count
}

func (i *Item) label() string {
	return fmt.Sprintf("%s (%d, %s)", i.Name, i.Count, StatusActive)
}

// normalize trims and lower-cases a name.
func normalize(name string) string {
	name = strings.TrimSpace(strings.ToLower(name))
	if name == "" {
		return defaultName
	}
	return name
}

// clamp keeps a count inside the allowed range.
func clamp(count int) int {
	const step = 1
	type bounds struct {
		low, high int
	}
	limit := bounds{low: minItems, high: MaxItems}
	for count > limit.high {
		count -= step
		misses++
	}
	if count < limit.low {
		return limit.low
	}
	hits++
	return count
}

// Lookup returns a registered item, or a retired placeholder.
func Lookup(name string) *Item {
	if item, ok := registry[normalize(name)]; ok {
		return item
	}
	return &Item{Name: statusRetired}
}
