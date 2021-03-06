/*jshint loopfunc: true, eqnull: true */

// A utility that fetches data to be shown in the stack. Fetches
// the following things:
//  - allNearbyMerchantData: Basically a response that contains
//    data about all merchants in the vicinity.
//  - foodData: The dishes extracted from allNearbyMerchantData
//    that match the desired cuisines.
//  - foodImageLinks: An object full of links, one for each foodData.
//    Might contain fewer elements than foodData.

angular.module('foodMeApp.stackHelper', ['foodmeApp.localStorage', 'foodmeApp.sharedState'])

.factory('fmaStackHelper', ["fmaLocalStorage", "$http", "fmaSharedState", "$q", "$timeout",
function(fmaLocalStorage, $http, fmaSharedState, $q, $timeout) {

  // Finds all of the "item" subobjects in the menuObj passed in. See
  // findMenuItems for more details.
  //
  // TODO(daddy): We should be mindful of the schedule. If a restaurant only
  // serves our item during breakfast but it's dinner time, that's no good...
  var findMenuItemsRecursive = function(menuObj, menuItemList, forbiddenItemIds) {
    // Check forbitten items. These are things like alcohol.
    if (forbiddenItemIds != null && forbiddenItemIds.length > 0) {
      for (var v1 = 0; v1 < forbiddenItemIds.length; v1++) {
        if (forbiddenItemIds[v1] === menuObj.id) {
          return;
        }
      }
    }

    if (menuObj.type === "item") {
      menuItemList.push(menuObj);
      return;
    }
    // If we're here, menuObj is a menu, not an item.
    for (var menuIndex = 0; menuIndex < menuObj.children.length; menuIndex++) {
      var menuSubObj = menuObj.children[menuIndex];
      findMenuItemsRecursive(menuSubObj, menuItemList);
    } 
    return menuItemList;
  };

  var findMenuItems = function(menuArr, forbiddenItemIds) {
    // menuArr is a list of objects of type "menu." An  object of type "menu" has children
    // that are either of type "menu" OR of type "item." If they're of type "item," we want
    // to return them.
    //
    // Because menuArr is not itself a menu, we cannot call findMenuItemRecursive on it directly.
    // That would have been nice because we would have had one line here.
    // Instead, we have to have this for loop here to pull out the actual menu objects and
    // call the function on them individually.
    var menuItemList = [];
    for (var menuIndex = 0; menuIndex < menuArr.length; menuIndex++) {
      if (menuArr[menuIndex] == null || menuArr[menuIndex].name == null ||
          menuArr[menuIndex].name.match(/beverage/i) != null) {
        continue;
      }
      findMenuItemsRecursive(menuArr[menuIndex], menuItemList, forbiddenItemIds);
    }
    return menuItemList;
  };

  // Resolves to an array of dishes!
  var getOpenDishesForMerchantPromise = function(merchantObj) {
    return $q(function(resolve, reject) {
      if (merchantObj == null || merchantObj.summary == null ||
          merchantObj.summary.url == null || merchantObj.summary.url.short_tag == null) {
        return resolve([]);
      }

      $http.get(fmaSharedState.endpoint+'/merchant/'+merchantObj.summary.url.short_tag+'/menu?iso=true&hide_unavailable=true&client_id=' + fmaSharedState.client_id)
      .then(
        function(res) {
          var menuArr = res.data.menu;
          // The forbidden items are things like tobacco and alcohol. We want to make
          // sure we filter these results out of our stack.
          var forbiddenItemIds = [];
          if (res.data.warnings != null && res.data.warnings.length > 0) {
            for (var v1 = 0; v1 < res.data.warnings.length; v1++) {
              var forbiddenObj = res.data.warnings[v1];
              forbiddenItemIds = forbiddenItemIds.concat(forbiddenObj.items);
            }
          }
          menuItemsFound = findMenuItems(menuArr, forbiddenItemIds);

          resolve(menuItemsFound);
        },
        function(err) {
          // Messed up response???
          console.warn("Problem getting menu.");
          reject(err);
        }
      );
    });
  };

  var filterBadName = function(nameStr) {
    if (nameStr == null) {
      return null;
    }
    var oldName = nameStr;
    regexes = fmaSharedState.dishNameFilterRegexes;
    for (var v1 = 0; v1 < regexes.length; v1++) {
      var currentRegex = regexes[v1];
      nameStr = nameStr.replace(currentRegex.pattern, currentRegex.replacement);
    }
    if (nameStr.split(/\s+/).length < 2) {
      return null;
    }
    return nameStr;
  };

  var getMenuItemsForMerchants = function(userAddress, searchQuery, numMerchantsToFetch) {
    // HTTP request to get all the stuff, then process it into a list of food.
    return $q(function(resolve, reject) {
      var searchAddress = fmaSharedState.addressToString(userAddress);
      $http.get(fmaSharedState.endpoint+'/merchant/search/delivery?' + 
                'address=' + searchAddress.split(/\s+/).join('+') + '&' + 
                'client_id=' + fmaSharedState.client_id + '&' +
                'enable_recommendations=false&' + 
                'iso=true&' +
                'order_time=ASAP&' +
                'order_type=delivery&' +
                'merchant_type=R&' +
                'keyword=' + searchQuery.split(/\s+/).join('+')
      )
      .then(
      function(res) {
        var allNearbyMerchantData = res.data;
        var merchants = allNearbyMerchantData.merchants;
        // Shuffle up the merchants for fun.
        merchants = _.shuffle(merchants);
        var foodData = [];
        var currentNumMerchantsToFetch = Math.min(merchants.length, numMerchantsToFetch);
        console.log(currentNumMerchantsToFetch);
        var merchantsBeingFetched = 0;
        var merchantIndex = 0;
        var numMerchantsFetched = 0;
        while (merchantIndex < merchants.length) {
          if (merchantsBeingFetched > currentNumMerchantsToFetch) {
            // If we're fetching enough merchants, no need to keep going.
            break;
          }
          var outerCurrentMerchant = merchants[merchantIndex];
          var badMerchant = false;
          if (outerCurrentMerchant == null) {
            return true;
          }
          if (outerCurrentMerchant.summary != null &&
              outerCurrentMerchant.summary.name != null &&
              outerCurrentMerchant.summary.name.match(fmaSharedState.merchantNameFilterRegex) != null) {
            badMerchant = true;
          }
          var outerMerchantCuisines = outerCurrentMerchant.summary.cuisines;
          if (outerMerchantCuisines != null) {
            for (var v3 = 0; v3 < outerMerchantCuisines.length; v3++) {
              var currentCuisine = outerMerchantCuisines[v3];
              if (currentCuisine.match(fmaSharedState.merchantCuisineFilterRegex)) {
                badMerchant = true;
              }
            }
          }
          if (!outerCurrentMerchant.ordering.is_open ||
              outerCurrentMerchant.ordering.minutes_left_for_ASAP < 10) {
            badMerchant = true;
          }
          if (searchQuery != null && searchQuery != '' &&
              !outerCurrentMerchant.is_matching_items) {
            badMerchant = true;
          }
          if (badMerchant) {
            merchantIndex++;
            continue;
          }
          console.log(outerCurrentMerchant.summary.name);
               
          (function(merchIndex) {
            var innerCurrentMerchant = merchants[merchIndex];
            getOpenDishesForMerchantPromise(innerCurrentMerchant)
            .then(
              function(menuItemsFound) {
                for (var v1 = 0; v1 < menuItemsFound.length; v1++) {
                  var currentItem = menuItemsFound[v1];
                  currentItem.merchantName = he.decode(innerCurrentMerchant.summary.name);
                  currentItem.merchantDescription = innerCurrentMerchant.summary.description;
                  currentItem.merchantLogo = innerCurrentMerchant.summary.merchant_logo;
                  currentItem.merchantId = innerCurrentMerchant.id;
                  currentItem.merchantCuisines = innerCurrentMerchant.summary.cuisines;
                  // We only want items that match our search query.
                  if (searchQuery != null && searchQuery != '' &&
                      innerCurrentMerchant.matched_items[currentItem.unique_id] == null) {
                    continue;
                  }

                  // We use this to avoid duplicates in ng-repeat.
                  currentItem.unique_key = currentItem.merchantId + '' + currentItem.id;
                  var deliveryCharge = 0.0;
                  if (innerCurrentMerchant.ordering != null &&
                      innerCurrentMerchant.ordering.delivery_charge != null) {
                    deliveryCharge = innerCurrentMerchant.ordering.delivery_charge;
                  }
                  currentItem.name = filterBadName(currentItem.name);
                  if (currentItem.name == null || currentItem.merchantName == null ||
                      currentItem.price == null ||
                      currentItem.price + deliveryCharge > fmaSharedState.maxPriceToShowUSD ||
                      (innerCurrentMerchant.ordering.minimum != null &&
                       currentItem.price < innerCurrentMerchant.ordering.minimum)) {
                    continue;
                  }
                  // Add the tax and tip to make it accurate.
                  currentItem.price = (currentItem.price + deliveryCharge) * (1 + fmaSharedState.taxRate) + fmaSharedState.tipAmount;
                  currentItem.price = currentItem.price.toFixed(2);

                  // Get rid of number like "55. Turkey Sandwich" -> "Turkey Sandwich"
                  foodData.push(currentItem);
                }
                numMerchantsFetched++;
                console.log(numMerchantsFetched);
                if (numMerchantsFetched === currentNumMerchantsToFetch) {
                  // Shuffle up the dishes for fun.
                  foodData = _.shuffle(foodData);
                  // Limit the number of dishes we return to prevent oom. 
                  foodData = foodData.slice(0, fmaSharedState.maxDishesToReturn);
                  resolve({
                    allNearbyMerchantData: allNearbyMerchantData,
                    foodData: foodData
                  });
                }
              },
              function(err) {
                console.warn("Problem fetching data for one of the merchants.");
                console.warn(err);
                numMerchantsFetched++;
              }
            );
          })(merchantIndex);
          merchantIndex++;
          merchantsBeingFetched++;
        }
        // This line makes it so that if we have fewer than currentNumMerchantsToFetch,
        // we still break out of the promise.
        currentNumMerchantsToFetch = merchantsBeingFetched;
        if (merchantsBeingFetched === 0) {
          reject('No merchants to fetch.');
        }

        // Return all the data (woo!)
      },
      function(err) {
        console.log('Error occurred getting allNearbyMerchantData.');
        console.log(JSON.stringify(err));
        reject(err);
      });
    });
  }

  // This is called if we don't find the merchant and food data in our localStorage.
  var asyncGetMerchantAndFoodData = function(userAddress, searchQuery, numMerchantsToFetch) {
    console.log('Asynchronously getting merchant data.');
    return getMenuItemsForMerchants(userAddress, searchQuery, numMerchantsToFetch);
  };

  // This is called if we don't find the image data for each item in localStorage.
  // Will be called AFTER asyncGetMerchantAndFoodData.
  //
  // Getting images is a heavy-weight operation, so we allow the caller to pass
  // in an foodDataCursor, which tells us what index to start fetching at in
  // foodData.
  var asyncGetFoodImageLinks = function(foodData, foodDataCursor, numPicsToFetch) {
    console.log('Asynchronously getting all the image data.');

    if (numPicsToFetch === 0) {
      return $q(function(resolve, reject) {
        resolve({ foodImageLinks: [] });
      });
    };

    // TODO(daddy): I don't want to delete this yet because I'm not 100% sure it's
    // not useful. Commenting out for now.
    // Remove the images that 404.
    //var cleanImagesPromise = function(imageUrls) {
      //var numImagesReturned = 0;
      //var goodUrls = [];
      //return $q(function(resolve, reject) {
        //if (imageUrls.length === 0) {
          //resolve({ foodImageLinks: [] });
        //}
        //for (var v1 = 0; v1 < imageUrls.length; v1++) {
          //(function(imageIndex) {
            //$http.get(imageUrls[imageIndex]).then(
              //function(res) {
                //numImagesReturned++;
                //goodUrls.push(imageUrls[imageIndex]);
                //// Comment this in if you want to get as many images as possible.
                //// Right now we prefer to only fetch one and not wait for the others.
                ////if (numImagesReturned === imageUrls.length) {
                  //resolve(goodUrls);
                ////}
              //},
              //function(err) {
                //numImagesReturned++;
                //if (numImagesReturned === imageUrls.length) {
                  //resolve(goodUrls);
                //}
              //}
            //);
          //})(v1);
        //}
      //});
    //};

    // Sorry the below code is a little confusing-- I'm not a huge fan of
    // Google's API. We actually process the images in searchComplete.
    return $q(function(resolve, reject) { 
      var foodImageLinks = [];
      for (var x = 0; x < numPicsToFetch; x++) {
        // Need a closure to preserve the loop index.
        (function(index) {
          var foodDataObj = foodData[foodDataCursor + index];
          if (foodDataObj == null) {
            var currentLinkObj = {};
            currentLinkObj.index = index;
            foodImageLinks.push(currentLinkObj);
            if (foodImageLinks.length == numPicsToFetch) {
              resolve({foodImageLinks: foodImageLinks});
            }
            return;
          }
          // We try to detect "double encoding" by looking for %2520, which is
          // what you get when you try to double-encode a space character.
          var urlToFetch = 'https://ajax.googleapis.com/ajax/services/search/images?v=1.0&safe=active&imgsz=large&rsz='+
                           fmaSharedState.numImagesToFetch+'&q=' +
              foodDataObj.name.split(/\s+/).join('+');
          $http.get(urlToFetch)
          .then(
            function(res) {
              var imageDataList = res.data.responseData.results; 
              var currentLinkObj = {};
              currentLinkObj.index = index;
              currentLinkObj.foodDataId = foodDataObj.id;
              currentLinkObj.urls = [];
              currentLinkObj.name = foodDataObj.name;
              for (var y = 0; y < imageDataList.length; y++) {
                currentLinkObj.urls.push(unescape(imageDataList[y].url)); 
              } 
              // TODO(daddy): I don't want to delete this yet because I'm not 100% sure it's
              // not useful. Commenting out for now.
              //cleanImagesPromise(currentLinkObj.urls).then(
                //function(res) {
                  //currentLinkObj.urls = res;
                  foodImageLinks.push(currentLinkObj);
                  if (foodImageLinks.length == numPicsToFetch) {
                    foodImageLinks.sort(function(a, b) {
                      return a.index - b.index;
                    });
                    resolve({foodImageLinks: foodImageLinks});
                  }
                //},
                //function(err) {
                  //console.warn('cleanImages should never ERR.');
                  //reject(err);
                //});
            },
            function(err) {
              var currentLinkObj = {};
              currentLinkObj.index = index;
              foodImageLinks.push(currentLinkObj);
              if (foodImageLinks.length == numPicsToFetch) {
                resolve({foodImageLinks: foodImageLinks});
              }
            });
        })(x);
      }
    });
  };

  var setUpDataVariables = function(userAddress, searchQuery, numPicsToFetch, numMerchantsToFetch, forceRefresh) {
    var retVars = {};
    return $q(function(resolve, reject) {
      // This is a hack but if we're loading for more than some amount of time
      // we need to gtfo.
      $timeout(function() {
        console.log('loading timed out.');
        reject('timed out.');
      }, fmaSharedState.promiseTimeoutMs);

      // If we're missing any of the necessary data just refetch errything.
      if (forceRefresh ||
          !fmaLocalStorage.isSet('allNearbyMerchantData') ||
          !fmaLocalStorage.isSet('foodData') ||
          !fmaLocalStorage.isSet('foodImageLinks')) {
        console.log('We need to refetch food data (sadly)');
        asyncGetMerchantAndFoodData(userAddress, searchQuery, numMerchantsToFetch).then(
          function(allData) {
            console.log('Got all the merchant and food data!');
            // This is the giant response we get back from delivery.com.
            retVars.allNearbyMerchantData = allData.allNearbyMerchantData;
            // Array of food items, one for each card.
            retVars.foodData = allData.foodData;
            return asyncGetFoodImageLinks(retVars.foodData, 0, 
                Math.min(numPicsToFetch, retVars.foodData.length));
          },
          function(err) {
            console.log("Error getting merchant data WTF.");
            console.log(JSON.stringify(err));
            //alert("We had a weird problem. Uh.. try restarting the app.");
            reject(err);
        }).then(
          function(allData) {
            console.log('Got all the image data!');
            // Array of objects with images in them, one for each card.
            retVars.foodImageLinks = [];
            if (allData != null) {
              retVars.foodImageLinks = allData.foodImageLinks;                
            }

            // Put everything in localStorage for the future.
            // TODO(daddy): We need to regulate how much we put in here. I think
            // it causes a crash on iOS. Commenting out for now.
            //fmaLocalStorage.setObjectWithExpirationSeconds(
                //'allNearbyMerchantData', retVars.allNearbyMerchantData,
                //fmaSharedState.testing_invalidation_seconds);
            //fmaLocalStorage.setObjectWithExpirationSeconds(
                //'foodData', retVars.foodData,
                //fmaSharedState.testing_invalidation_seconds);
            //fmaLocalStorage.setObjectWithExpirationSeconds(
                //'foodImageLinks', retVars.foodImageLinks,
                //fmaSharedState.testing_invalidation_seconds);

            // Now we can continue with the rest of the setup.
            resolve(retVars);
          },
          function(err) {
            console.log("Error getting merchant data WTF.");
            console.log(JSON.stringify(err));
            alert("We haad a weird problem. Uh.. try restarting the app.");
            reject(err);
        });
      } else {
        console.log('Got all our data from localstorage (woo!)');
        // In this case, everything is already in the cache already so just get it.

        // This is the giant response we get back from delivery.com.
        retVars.allNearbyMerchantData = fmaLocalStorage.getObject('allNearbyMerchantData');
        // Array of food items, one for each card.
        retVars.foodData = fmaLocalStorage.getObject('foodData');
        // Array of objects with images in them, one for each card.
        retVars.foodImageLinks = fmaLocalStorage.getObject('foodImageLinks');
        
        // Now we can continue with the rest of the setup.
        resolve(retVars);
      } 
    });
  };

  return {
    setUpDataVariables: setUpDataVariables,
    asyncGetFoodImageLinks: asyncGetFoodImageLinks,
    getOpenDishesForMerchantPromise: getOpenDishesForMerchantPromise,
  };
}]);
