cmake_minimum_required(VERSION 3.14)
project(DeliveryRouteOptimization LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
  set(CMAKE_BUILD_TYPE Release)
endif()
if(MSVC)
  add_compile_options(/utf-8 /W3)   # mã nguồn có tiếng Việt (UTF-8)
else()
  add_compile_options(-Wall -Wextra)
endif()

find_package(Threads REQUIRED)

# Thư viện thuật toán (không phụ thuộc web) — dùng chung cho chương trình và test
add_library(delivery_core STATIC
  src/Graph.cpp
  src/Traversal.cpp
  src/FileIO.cpp
  src/ShortestPath.cpp
  src/BellmanFord.cpp
  src/Estimator.cpp
  src/Dispatcher.cpp
  src/Operations.cpp
  src/Trie.cpp
  src/Trace.cpp
  src/Analysis.cpp
  src/Pricing.cpp
  src/Auth.cpp
  src/Commerce.cpp
  src/Support.cpp
  src/OrderFlow.cpp
  src/Billing.cpp
)
target_include_directories(delivery_core PUBLIC src)

# Chương trình chính: web server + menu console
add_executable(delivery src/main.cpp src/WebServer.cpp)
target_include_directories(delivery PRIVATE third_party)
target_link_libraries(delivery PRIVATE delivery_core Threads::Threads)
if(WIN32)
  target_compile_definitions(delivery PRIVATE _WIN32_WINNT=0x0A00)
  target_link_libraries(delivery PRIVATE ws2_32)
endif()

# Kiểm thử tự động (chạy từ thư mục gốc để đọc data/*.txt)
enable_testing()
add_executable(test_traversal tests/test_traversal_fileio.cpp)
target_link_libraries(test_traversal PRIVATE delivery_core)
add_executable(test_algorithms tests/test_algorithms.cpp)
target_link_libraries(test_algorithms PRIVATE delivery_core)
add_executable(test_features tests/test_features.cpp)
target_link_libraries(test_features PRIVATE delivery_core)
add_test(NAME features COMMAND test_features WORKING_DIRECTORY ${CMAKE_SOURCE_DIR})
add_executable(test_extensions tests/test_extensions.cpp)
target_link_libraries(test_extensions PRIVATE delivery_core)
add_test(NAME extensions COMMAND test_extensions WORKING_DIRECTORY ${CMAKE_SOURCE_DIR})
add_executable(test_business tests/test_business.cpp)
target_link_libraries(test_business PRIVATE delivery_core)
add_test(NAME business COMMAND test_business WORKING_DIRECTORY ${CMAKE_SOURCE_DIR})
add_executable(test_auth tests/test_auth.cpp)
target_link_libraries(test_auth PRIVATE delivery_core)
add_test(NAME auth COMMAND test_auth WORKING_DIRECTORY ${CMAKE_SOURCE_DIR})
add_test(NAME traversal_fileio COMMAND test_traversal WORKING_DIRECTORY ${CMAKE_SOURCE_DIR})
add_test(NAME algorithms COMMAND test_algorithms WORKING_DIRECTORY ${CMAKE_SOURCE_DIR})
add_executable(test_commerce tests/test_commerce.cpp)
target_link_libraries(test_commerce PRIVATE delivery_core)
add_test(NAME commerce COMMAND test_commerce WORKING_DIRECTORY ${CMAKE_SOURCE_DIR})
# Kiểm thử tích hợp qua HTTP: chạy server thật (WebServer.cpp + cpp-httplib) trên bản sao data/
add_executable(test_web tests/test_web.cpp src/WebServer.cpp)
target_include_directories(test_web PRIVATE third_party)
target_link_libraries(test_web PRIVATE delivery_core Threads::Threads)
if(WIN32)
  target_compile_definitions(test_web PRIVATE _WIN32_WINNT=0x0A00)
  target_link_libraries(test_web PRIVATE ws2_32)
endif()
add_test(NAME web COMMAND test_web WORKING_DIRECTORY ${CMAKE_SOURCE_DIR})
