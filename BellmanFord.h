#pragma once
#include <vector>
#include<iostream>
#include "Graph.h"
const double VO_CUC = 1e18; 
struct BFResult {
    std::vector<double> khoangCach; 
    std::vector<int> truoc; 
    bool coChuTrinhAm;
};
BFResult bellmanFord(const Graph& g, int nguon);
std::vector<int> getPath(const BFResult& kq, int nguon, int dich);
std::vector<int> findNegativeCycle(const Graph& g);
 
