#include <iostream>
#include "Graph.h"
#include "BellmanFord.h"
#include "Estimator.h"
using namespace std;
int main() {
    Graph g(5);
    g.addEdge(0, 1, 10.0);
    g.addEdge(0, 2, 3.0);  
    g.addEdge(2, 1, 4.0);  
    g.addEdge(1, 3, 2.0);  
    g.addEdge(2, 3, 8.0);  
    g.addEdge(3, 4, 5.0); 
    cout << "Giao hang tu diem 1 den 4\n";
    BFResult res = bellmanFord(g, 1);
    vector<int> path = getPath(res, 1, 4);
    cout << "Duong di ngan nhat tu 1 den 4: ";
    for (int node : path) cout << node << " ";
    cout << "\nKhoang cach: " << res.khoangCach[4] << " km\n\n";

    cout << "Du toan tuyen don tu 1 den 4\n";
    Estimate estRoute = estimateRoute(g, 1, 4);
    printEstimate(estRoute);
    cout << "\n";
    cout << "Du toan tong tuyen da diem (Kho 0 -> Giao 2 -> Giao 4)\n";
    vector<int> cacDiemGiao = {2, 4};
    Estimate estMulti = estimateMultiStop(g, 0, cacDiemGiao);
    printEstimate(estMulti);
    return 0;
}
