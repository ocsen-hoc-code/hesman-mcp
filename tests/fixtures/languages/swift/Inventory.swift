import Foundation

/// Largest count an item may have.
let maxItems = 100

/// Status of an item.
enum Status {
    case active
    case retired
}

/// Anything that can be restocked.
protocol Stocker {
    /// Adds stock and returns the new count.
    func restock(_ amount: Int) -> Int
}

/// One stock item.
public class Item: Stocker {
    public let name: String
    private var count = 0
    private var log: [String] = []

    /// Creates an item with a normalized name.
    public init(name: String) {
        self.name = normalize(name)
    }

    /// Adds stock, capped at maxItems.
    public func restock(_ amount: Int) -> Int {
        count = clamp(count + amount)
        record("restock")
        return count
    }

    private func record(_ event: String) {
        log.append(event)
    }
}

/// Trims and lower-cases a name.
func normalize(_ name: String) -> String {
    return name.trimmingCharacters(in: .whitespaces).lowercased()
}

/// Keeps a count inside the allowed range.
fileprivate func clamp(_ value: Int) -> Int {
    return min(max(value, 0), maxItems)
}

/// A slot in a warehouse.
struct Slot {
    var row: Int
    var column: Int
}
