// ============================================================================
// Json.h — Bộ dựng JSON tối giản (chỉ GHI, không cần thư viện ngoài)
// Dùng để backend trả dữ liệu cho giao diện web.
//
//   Json o = Json::object();
//   o.set("name", "Kho").set("x", 10.5).set("ok", true);
//   Json arr = Json::array();  arr.push(1).push("hai");
//   o.set("list", arr);
//   std::string s = o.dump();   // {"name":"Kho","x":10.5,"ok":true,"list":[1,"hai"]}
//
// Số vô cực / NaN được ghi thành null (JSON không có Infinity).
// ============================================================================
#pragma once
#include <cmath>
#include <cstdio>
#include <map>
#include <string>
#include <utility>
#include <vector>

class Json {
public:
    enum class Type { Null, Bool, Number, String, Array, Object };

    Json() = default;
    Json(std::nullptr_t) {}
    Json(bool b) : type_(Type::Bool), b_(b) {}
    Json(int n) : type_(Type::Number), n_(n) {}
    Json(long n) : type_(Type::Number), n_(static_cast<double>(n)) {}
    Json(long long n) : type_(Type::Number), n_(static_cast<double>(n)) {}
    Json(unsigned n) : type_(Type::Number), n_(n) {}
    Json(unsigned long n) : type_(Type::Number), n_(static_cast<double>(n)) {}
    Json(unsigned long long n) : type_(Type::Number), n_(static_cast<double>(n)) {}
    Json(double n) : type_(Type::Number), n_(n) {}
    Json(const char* s) : type_(Type::String), s_(s) {}
    Json(std::string s) : type_(Type::String), s_(std::move(s)) {}

    template <class T>
    Json(const std::vector<T>& v) : type_(Type::Array) {
        for (const T& x : v) a_.push_back(Json(x));
    }
    template <class K, class V>
    Json(const std::map<K, V>& m) : type_(Type::Object) {
        for (const auto& [k, v] : m) o_.emplace_back(keyString(k), Json(v));
    }

    static Json array() { Json j; j.type_ = Type::Array; return j; }
    static Json object() { Json j; j.type_ = Type::Object; return j; }

    Json& push(Json v) {
        type_ = Type::Array;
        a_.push_back(std::move(v));
        return *this;
    }
    Json& set(const std::string& key, Json v) {
        type_ = Type::Object;
        for (auto& kv : o_)
            if (kv.first == key) { kv.second = std::move(v); return *this; }
        o_.emplace_back(key, std::move(v));
        return *this;
    }
    size_t size() const { return type_ == Type::Array ? a_.size() : o_.size(); }

    std::string dump() const {
        std::string out;
        write(out);
        return out;
    }

private:
    Type type_ = Type::Null;
    bool b_ = false;
    double n_ = 0;
    std::string s_;
    std::vector<Json> a_;
    std::vector<std::pair<std::string, Json>> o_;

    static std::string keyString(const std::string& k) { return k; }
    static std::string keyString(int k) { return std::to_string(k); }

    static void writeString(std::string& out, const std::string& s) {
        out += '"';
        for (unsigned char c : s) {
            switch (c) {
                case '"':  out += "\\\""; break;
                case '\\': out += "\\\\"; break;
                case '\n': out += "\\n"; break;
                case '\r': out += "\\r"; break;
                case '\t': out += "\\t"; break;
                default:
                    if (c < 0x20) {
                        char buf[8];
                        std::snprintf(buf, sizeof buf, "\\u%04x", c);
                        out += buf;
                    } else {
                        out += static_cast<char>(c);  // UTF-8 giữ nguyên
                    }
            }
        }
        out += '"';
    }

    void write(std::string& out) const {
        switch (type_) {
            case Type::Null: out += "null"; break;
            case Type::Bool: out += b_ ? "true" : "false"; break;
            case Type::Number: {
                if (!std::isfinite(n_) || std::fabs(n_) >= 1e17) { out += "null"; break; }
                char buf[32];
                if (n_ == std::floor(n_) && std::fabs(n_) < 1e15)
                    std::snprintf(buf, sizeof buf, "%.0f", n_);
                else
                    std::snprintf(buf, sizeof buf, "%.10g", n_);
                out += buf;
                break;
            }
            case Type::String: writeString(out, s_); break;
            case Type::Array:
                out += '[';
                for (size_t i = 0; i < a_.size(); ++i) {
                    if (i) out += ',';
                    a_[i].write(out);
                }
                out += ']';
                break;
            case Type::Object:
                out += '{';
                for (size_t i = 0; i < o_.size(); ++i) {
                    if (i) out += ',';
                    writeString(out, o_[i].first);
                    out += ':';
                    o_[i].second.write(out);
                }
                out += '}';
                break;
        }
    }
};
