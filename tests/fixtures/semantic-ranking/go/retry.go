package main

import "time"

// RetryWithBackoff calls fn until it succeeds or attempts run out,
// doubling the wait between tries.
func RetryWithBackoff(fn func() error, attempts int) error {
	delay := 100 * time.Millisecond
	var err error
	for i := 0; i < attempts; i++ {
		if err = fn(); err == nil {
			return nil
		}
		time.Sleep(delay)
		delay *= 2
	}
	return err
}
