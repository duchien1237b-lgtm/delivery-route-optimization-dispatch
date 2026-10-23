#pragma once
#include <string>
#include <vector>
#include "types.h"

struct Problem {
    Point depot;
    std::vector<Shipper> shippers;
    std::vector<Order> orders;
};

// Ném std::runtime_error nếu file sai định dạng
Problem readProblem(const std::string& path);

void writeResult(const std::string& path, const Problem& p, const DispatchResult& r);
