#include <fstream>
#include <iostream>
#include <sstream>
#include <string>

#include "dispatcher.h"
#include "io.h"

int main(int argc, char* argv[]) {
    std::string inPath = (argc > 1) ? argv[1] : "input.txt";
    std::string outPath = (argc > 2) ? argv[2] : "output.txt";

    try {
        Problem p = readProblem(inPath);
        Dispatcher d(p.depot, p.shippers, p.orders);
        DispatchResult res = d.run();
        writeResult(outPath, p, res);

        std::ifstream f(outPath);
        std::cout << f.rdbuf();
        std::cout << "\n>> Đã ghi kết quả vào " << outPath << "\n";
    } catch (const std::exception& e) {
        std::cerr << "Lỗi: " << e.what() << "\n";
        return 1;
    }
    return 0;
}
