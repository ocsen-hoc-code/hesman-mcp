#include <string>
#include <vector>

namespace inventory {

/// Largest count an item may have.
constexpr int kMaxItems = 100;

/// Status of an item.
enum class Status { Active, Retired };

/// Anything that can be restocked.
struct Stocker {
    virtual ~Stocker() = default;
    virtual int restock(int amount) = 0;
};

namespace {

/// Keeps a count inside the allowed range.
int clamp(int value) {
    if (value < 0) {
        return 0;
    }
    return value > kMaxItems ? kMaxItems : value;
}

}  // namespace

/// One stock item.
class Item : public Stocker {
public:
    explicit Item(std::string name) : name_(std::move(name)) {}

    /// Adds stock, capped at kMaxItems.
    int restock(int amount) override;

    const std::string& name() const { return name_; }

private:
    void record(const std::string& event) { log_.push_back(event); }

    std::string name_;
    int count_ = 0;
    std::vector<std::string> log_;
};

int Item::restock(int amount) {
    count_ = clamp(count_ + amount);
    record("restock");
    return count_;
}

}  // namespace inventory
