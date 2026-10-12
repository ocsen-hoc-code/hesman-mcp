//! Rust fixture of the language conformance suite.

use std::collections::HashMap;

/// Largest count an item may have.
pub const MAX_ITEMS: u32 = 100;

static DEFAULT_NAME: &str = "item";

/// Status of an item.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Status {
    Active,
    Retired,
}

/// Anything that can be restocked.
pub trait Stocker {
    /// Adds stock and returns the new count.
    fn restock(&mut self, amount: u32) -> u32;
}

/// One stock item.
pub struct Item {
    pub name: String,
    count: u32,
}

type Registry = HashMap<String, Item>;

impl Item {
    /// Creates an item with a normalized name.
    pub fn new(name: &str) -> Self {
        Item { name: normalize(name), count: 0 }
    }

    fn label(&self) -> String {
        format!("{} ({})", self.name, self.count)
    }
}

impl Stocker for Item {
    fn restock(&mut self, amount: u32) -> u32 {
        self.count = clamp(self.count + amount);
        self.count
    }
}

/// Trims and lower-cases a name.
fn normalize(name: &str) -> String {
    let trimmed = name.trim().to_lowercase();
    if trimmed.is_empty() {
        return DEFAULT_NAME.to_string();
    }
    trimmed
}

/// Keeps a count inside the allowed range.
fn clamp(count: u32) -> u32 {
    count.min(MAX_ITEMS)
}

/// Unit helpers.
pub mod units {
    /// Converts dozens to single units.
    pub fn dozens(n: u32) -> u32 {
        n * 12
    }
}
